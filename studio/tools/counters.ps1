# GPU, disk and network use for the studio sampler: one JSON line per sample, about every 1.5 s, until killed.
# The counter list is expanded again for every sample, so a GPU process started later (Chrome) is counted too.
$c = '\GPU Engine(*engtype_3D)\Utilization Percentage',
     '\PhysicalDisk(_Total)\Disk Read Bytes/sec',
     '\PhysicalDisk(_Total)\Disk Write Bytes/sec',
     '\Network Interface(*)\Bytes Total/sec'
while ($true) {
  try {
    $s = Get-Counter -Counter $c -MaxSamples 1 -ErrorAction SilentlyContinue
    $g = 0; $r = 0; $w = 0; $n = 0
    foreach ($x in $s.CounterSamples) {
      $p = $x.Path
      if ($p -like '*gpu engine*') { $g += $x.CookedValue }
      elseif ($p -like '*disk read bytes*') { $r = $x.CookedValue }
      elseif ($p -like '*disk write bytes*') { $w = $x.CookedValue }
      elseif ($p -like '*network interface*') { $n += $x.CookedValue }
    }
    $o = @{ gpu = [math]::Round([math]::Min(100, $g), 1); r = [math]::Round($r / 1MB, 2); w = [math]::Round($w / 1MB, 2); n = [math]::Round($n / 1MB, 3) }
    [Console]::Out.WriteLine(($o | ConvertTo-Json -Compress))
    [Console]::Out.Flush()
  } catch {
    Start-Sleep -Seconds 1
  }
}
