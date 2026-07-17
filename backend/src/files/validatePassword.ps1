Add-Type -AssemblyName System.DirectoryServices.AccountManagement
$ctx = [System.DirectoryServices.AccountManagement.PrincipalContext]::new(
    [System.DirectoryServices.AccountManagement.ContextType]::Machine,
    $env:COMPUTERNAME
)
if ($ctx.ValidateCredentials($env:USERNAME, $env:SM_PASSWORD)) {
    Write-Output "OK"
} else {
    Write-Output "FAIL"
}
