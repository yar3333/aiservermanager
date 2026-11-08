# Validates the dashboard login against the local Security Account Manager.
#
# LogonUser with LOGON32_LOGON_NETWORK is the documented way to check a password:
# it loads no profile and answers in milliseconds. The previous implementation
# used System.DirectoryServices.AccountManagement, which took ~10 s per attempt
# whenever the name did not resolve to an account — long enough to trip the
# backend's own timeout, so a wrong account looked like a hung verifier.
#
# Inputs arrive as environment variables, never on the command line, so a
# password never lands in a process command line the OS can show.
$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

public static class NativeAdvapi32
{
    [DllImport("advapi32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    public static extern bool LogonUserW(
        string lpszUsername,
        string lpszDomain,
        string lpszPassword,
        int dwLogonType,
        int dwLogonProvider,
        out SafeAccessTokenHandle phToken);
}
'@

if ([string]::IsNullOrEmpty($env:SM_USERNAME)) {
    Write-Output "ERROR no-account"
    exit 0
}

# An empty domain makes LogonUser resolve the name itself; the caller sends "."
# or the machine name when it means a local account, and nothing for a UPN.
$domain = $env:SM_DOMAIN
if ([string]::IsNullOrEmpty($domain)) { $domain = $null }

# ERROR_LOGON_FAILURE: wrong account or wrong password — the only answer that may
# count against the brute-force lockout. Anything else (1385 logon type denied,
# 1331 account disabled, 5 access denied) is a setup problem, not a bad password.
$ERROR_LOGON_FAILURE = 1326
$LOGON32_LOGON_NETWORK = 3
$LOGON32_PROVIDER_DEFAULT = 0

$token = [Microsoft.Win32.SafeHandles.SafeAccessTokenHandle]::InvalidHandle
try {
    $validated = [NativeAdvapi32]::LogonUserW(
        $env:SM_USERNAME, $domain, $env:SM_PASSWORD,
        $LOGON32_LOGON_NETWORK, $LOGON32_PROVIDER_DEFAULT, [ref]$token)

    if ($validated) {
        Write-Output "OK"
    } else {
        $code = [System.Runtime.InteropServices.Marshal]::GetLastWin32Error()
        if ($code -eq $ERROR_LOGON_FAILURE) { Write-Output "FAIL $code" }
        else { Write-Output "ERROR $code" }
    }
} catch {
    Write-Output "ERROR $($_.Exception.GetType().Name)"
} finally {
    $token.Dispose()
}
