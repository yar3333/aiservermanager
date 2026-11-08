param(
    [string]$Domain = $env:SM_ACCOUNT_DOMAIN,
    [string]$User = $env:SM_ACCOUNT_NAME,
    [string]$Right = "SeServiceLogonRight"
)

# Grants a user right to a service account through the LSA policy API — the same
# store secpol.msc edits. The Service Control Manager refuses to log a service
# account on (error 1069, System log event 7041) until the account holds
# SeServiceLogonRight, and registering the service does not grant it.
#
# Account is taken from the command line or from SM_ACCOUNT_DOMAIN /
# SM_ACCOUNT_NAME, so the caller never puts the identity in a shell string.
# Prints "OK: …" on success, "FAIL: …" plus a non-zero exit code otherwise.
$code = @'
using System;
using System.Runtime.InteropServices;

public static class LsaRights
{
    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_UNICODE_STRING
    {
        public ushort Length;
        public ushort MaximumLength;
        public IntPtr Buffer;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LSA_OBJECT_ATTRIBUTES
    {
        public int Length;
        public IntPtr RootDirectory;
        public IntPtr ObjectName;
        public int Attributes;
        public IntPtr SecurityDescriptor;
        public IntPtr SecurityQualityOfService;
    }

    private const int POLICY_ALL_ACCESS = 0x000F003F;
    private const int STATUS_OBJECT_NAME_NOT_FOUND = unchecked((int)0xC0000034);
    // An account the policy store holds no rights for comes back as NONE_MAPPED
    // rather than an empty list — a normal state for a user account, since a right
    // held through a group is not an entry under that account's own SID.
    private const int STATUS_NONE_MAPPED = unchecked((int)0xC0000073);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int LsaOpenPolicy(IntPtr SystemName, ref LSA_OBJECT_ATTRIBUTES ObjectAttributes, int Access, out IntPtr PolicyHandle);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern int LsaAddAccountRights(IntPtr PolicyHandle, byte[] AccountSid, LSA_UNICODE_STRING[] UserRights, int CountOfRights);

    [DllImport("advapi32.dll")]
    private static extern int LsaEnumerateAccountRights(IntPtr PolicyHandle, byte[] AccountSid, out IntPtr UserRights, out uint CountOfRights);

    [DllImport("advapi32.dll")]
    private static extern int LsaFreeMemory(IntPtr Buffer);

    [DllImport("advapi32.dll")]
    private static extern int LsaClose(IntPtr PolicyHandle);

    [DllImport("advapi32.dll")]
    private static extern int LsaNtStatusToWinError(int Status);

    [StructLayout(LayoutKind.Sequential)]
    private struct LUID
    {
        public uint LowPart;
        public int HighPart;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct LUID_AND_ATTRIBUTES
    {
        public LUID Luid;
        public uint Attributes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct TOKEN_PRIVILEGES
    {
        public uint PrivilegeCount;
        public LUID_AND_ATTRIBUTES Privilege;
    }

    private const int TOKEN_ADJUST_PRIVILEGES = 0x0020;
    private const int TOKEN_QUERY = 0x0008;
    private const uint SE_PRIVILEGE_ENABLED = 0x00000002;
    private const int ERROR_NOT_ALL_ASSIGNED = 1300;

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr ProcessHandle, int DesiredAccess, out IntPtr TokenHandle);

    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    private static extern bool LookupPrivilegeValue(string lpSystemName, string lpName, out LUID lpLuid);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool AdjustTokenPrivileges(IntPtr TokenHandle, bool DisableAllPrivileges, ref TOKEN_PRIVILEGES NewState, int BufferLength, IntPtr PreviousState, IntPtr ReturnLength);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr hObject);

    /**
     * Turn a privilege on for this process and say what happened.
     *
     * Reading or writing the security policy needs SeSecurityPrivilege ENABLED,
     * and the privilege is put into a token switched off: an elevated
     * administrator token and a LocalSystem service token both hold it disabled,
     * so without this call LsaEnumerateAccountRights answers access-denied even
     * though LsaOpenPolicy already succeeded.
     */
    public static string EnablePrivilege(string name)
    {
        IntPtr token;
        if (!OpenProcessToken(GetCurrentProcess(), TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, out token))
            return "cannot open this process token (Win32 error " + Marshal.GetLastWin32Error() + ")";
        try
        {
            LUID luid;
            if (!LookupPrivilegeValue(null, name, out luid))
                return "'" + name + "' is unknown on this machine (Win32 error " + Marshal.GetLastWin32Error() + ")";

            var state = new TOKEN_PRIVILEGES
            {
                PrivilegeCount = 1,
                Privilege = new LUID_AND_ATTRIBUTES { Luid = luid, Attributes = SE_PRIVILEGE_ENABLED }
            };
            if (!AdjustTokenPrivileges(token, false, ref state, Marshal.SizeOf(typeof(TOKEN_PRIVILEGES)), IntPtr.Zero, IntPtr.Zero))
                return "cannot enable '" + name + "' (Win32 error " + Marshal.GetLastWin32Error() + ")";

            // AdjustTokenPrivileges returns true when it assigned nothing at all;
            // that is the case of a token that simply does not hold the privilege,
            // which no amount of elevation-in-name can fix.
            int notAssigned = Marshal.GetLastWin32Error();
            if (notAssigned == ERROR_NOT_ALL_ASSIGNED)
                return "this process does not hold '" + name + "' — run it elevated";
            return "ok";
        }
        finally { CloseHandle(token); }
    }

    private static int Open(out IntPtr policy)
    {
        var oa = new LSA_OBJECT_ATTRIBUTES { Length = Marshal.SizeOf(typeof(LSA_OBJECT_ATTRIBUTES)) };
        return LsaOpenPolicy(IntPtr.Zero, ref oa, POLICY_ALL_ACCESS, out policy);
    }

    private static LSA_UNICODE_STRING ToLsaString(string value)
    {
        return new LSA_UNICODE_STRING
        {
            Length = (ushort)(value.Length * 2),
            MaximumLength = (ushort)((value.Length + 1) * 2),
            Buffer = Marshal.StringToHGlobalUni(value)
        };
    }

    /** 0 on success, otherwise the Win32 error that the NT status maps to. */
    public static int Grant(byte[] sid, string[] rights)
    {
        IntPtr policy;
        int status = Open(out policy);
        if (status != 0) return LsaNtStatusToWinError(status);
        try
        {
            var strings = new LSA_UNICODE_STRING[rights.Length];
            for (int i = 0; i < rights.Length; i++) strings[i] = ToLsaString(rights[i]);
            status = LsaAddAccountRights(policy, sid, strings, rights.Length);
            foreach (var s in strings) Marshal.FreeHGlobal(s.Buffer);
            return status == 0 ? 0 : LsaNtStatusToWinError(status);
        }
        finally { LsaClose(policy); }
    }

    /** Rights already assigned to the account; empty when it has none. */
    public static string[] Enumerate(byte[] sid)
    {
        IntPtr policy;
        int status = Open(out policy);
        // The code goes into the message, not only into the exception's HResult:
        // PowerShell prints Message for a COMException, and a bare
        // "LsaEnumerateAccountRights failed" leaves the operator — and the log —
        // with no way to tell access-denied from a name that maps to nothing.
        // Concatenation, not $"…": Add-Type on Windows PowerShell compiles C# 5.
        if (status != 0) throw new COMException("LsaOpenPolicy failed (Win32 error " + LsaNtStatusToWinError(status) + ")", LsaNtStatusToWinError(status));
        try
        {
            IntPtr rightsPtr;
            uint count;
            status = LsaEnumerateAccountRights(policy, sid, out rightsPtr, out count);
            // Neither code is a failure to read: both mean the store has no rights
            // recorded for this account, which is where every first install starts.
            if (status == STATUS_OBJECT_NAME_NOT_FOUND || status == STATUS_NONE_MAPPED) return new string[0];
            if (status != 0) throw new COMException("LsaEnumerateAccountRights failed (Win32 error " + LsaNtStatusToWinError(status) + ")", LsaNtStatusToWinError(status));
            try
            {
                var result = new string[count];
                int size = Marshal.SizeOf(typeof(LSA_UNICODE_STRING));
                for (uint i = 0; i < count; i++)
                {
                    var us = (LSA_UNICODE_STRING)Marshal.PtrToStructure(IntPtr.Add(rightsPtr, (int)i * size), typeof(LSA_UNICODE_STRING));
                    result[i] = Marshal.PtrToStringUni(us.Buffer, us.Length / 2);
                }
                return result;
            }
            finally { LsaFreeMemory(rightsPtr); }
        }
        finally { LsaClose(policy); }
    }
}
'@

function Fail([string]$message) {
    Write-Output "FAIL: $message"
    exit 1
}

if (-not $User) { Fail "no account name (pass -User or set SM_ACCOUNT_NAME)" }

try {
    Add-Type -TypeDefinition $code -ErrorAction Stop
} catch {
    Fail "cannot load the LSA policy API: $($_.Exception.Message)"
}

# Reading and writing the security policy needs SeSecurityPrivilege ENABLED in
# this process, and it lands in a token switched off — in an elevated
# administrator shell and in a LocalSystem service alike. Without this the policy
# opens but every read of an account's rights is denied.
$privilegeState = [LsaRights]::EnablePrivilege("SeSecurityPrivilege")
function WithPrivilege([string]$message) {
    if ($privilegeState -eq "ok") { return $message }
    return "$message (SeSecurityPrivilege: $privilegeState)"
}

# A user@domain identity carries its own domain; anything else needs one, and the
# caller already expanded the "." (local machine) shorthand.
try {
    if (-not $Domain -and $User.Contains("@")) {
        $identity = New-Object System.Security.Principal.NTAccount($User)
    } elseif ($Domain) {
        $identity = New-Object System.Security.Principal.NTAccount($Domain, $User)
    } else {
        $identity = New-Object System.Security.Principal.NTAccount($User)
    }
    $sid = $identity.Translate([System.Security.Principal.SecurityIdentifier])
} catch {
    Fail "cannot resolve account '$($(if ($Domain) { "$Domain\" }) + $User)': $($_.Exception.Message.Trim())"
}

$sidBytes = New-Object byte[] $sid.BinaryLength
$sid.GetBinaryForm($sidBytes, 0)
$fullName = "$($sid.Translate([System.Security.Principal.NTAccount]))"

try {
    if ([LsaRights]::Enumerate($sidBytes) -contains $Right) {
        Write-Output "OK: $fullName already has $Right"
        exit 0
    }
    $grantStatus = [LsaRights]::Grant($sidBytes, @($Right))
} catch {
    Fail (WithPrivilege "$($Right): $($_.Exception.Message.Trim())")
}

if ($grantStatus -ne 0) {
    Fail (WithPrivilege "cannot grant $Right to $fullName (Win32 error $grantStatus). Writing the right needs the 'Manage auditing and security log' privilege enabled in the process that writes it — or assign the right in secpol.msc (Local Policies → User Rights Assignment).")
}

Write-Output "OK: granted $Right to $fullName"
