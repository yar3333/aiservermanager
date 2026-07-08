Get-CimInstance -ClassName Win32_VideoController | ForEach-Object {
  $pciBusId = "";
  try {
    $regKey = "HKLM:\SYSTEM\CurrentControlSet\Enum\" + $_.PNPDeviceID;
    $props = Get-ItemProperty $regKey -ErrorAction Stop;
    if ($props.LocationInformation -match '\((\d+),(\d+),(\d+)\)') {
      $pciBusId = "{0:X2}:{1:X2}.{2}" -f [int]$Matches[1], [int]$Matches[2], $Matches[3];
    }
  } catch {}
  [PSCustomObject]@{
    name = $_.Name;
    vram = $_.AdapterRAM;
    pci  = $pciBusId;
  }
} | ConvertTo-Json
