$Action = New-ScheduledTaskAction -Execute "C:\Users\koike-m\Desktop\Claude Code\run_brillio_daily.bat"
$Trigger = New-ScheduledTaskTrigger -Daily -At "15:00"
$Settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -StartWhenAvailable
Register-ScheduledTask -TaskName "BrillioDaily" -Action $Action -Trigger $Trigger -Settings $Settings -Force
Write-Host "Task registered successfully"
