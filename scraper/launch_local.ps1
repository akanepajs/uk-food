# Launcher for the local daily retail scrape (Task Scheduler action since
# 2026-10-22). The task runs the INSTALLED copy of this file:
#   %LOCALAPPDATA%\uk-food-scrape\launch.ps1
# via `conhost.exe --headless powershell.exe -File <launch.ps1>`. This repo
# copy is the source; after editing it, copy it over the installed one.
#
# Why it exists: conhost --headless swallows every exit code, so since
# 2026-10-10 Task Scheduler showed result 0 even when run_daily_local.ps1
# failed. On 2026-10-22 the repo had moved out of OneDrive, the task still
# pointed at the deleted path, both runs did nothing and logged nothing, and
# only check-freshness (14:45 UTC) noticed. The launcher lives outside the
# repo so a repo move cannot take it along; it logs and raises a Windows toast
# when the script is missing or exits non-zero.

param([string]$Script = 'C:\w\hwfa-food\site\scraper\run_daily_local.ps1')

$LogDir = Join-Path $env:LOCALAPPDATA 'uk-food-scrape'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'scrape.log'

function Write-Log($msg) {
    Add-Content -Path $Log -Value "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) $msg" -Encoding utf8
}

# Toast as Windows PowerShell's registered app id (no extra module needed);
# msg.exe if WinRT is unavailable.
function Show-Alert($text) {
    try {
        [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
        [void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime]
        $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
        $body = [Security.SecurityElement]::Escape($text)
        $xml.LoadXml("<toast><visual><binding template='ToastGeneric'><text>uk-food scrape FAILED</text><text>$body</text></binding></visual></toast>")
        $appId = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\WindowsPowerShell\v1.0\powershell.exe'
        [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($appId).Show((New-Object Windows.UI.Notifications.ToastNotification $xml))
    } catch {
        Write-Log "  [launcher] toast failed ($($_.Exception.Message)); using msg.exe"
        & msg.exe $env:USERNAME "uk-food scrape FAILED: $text"
    }
}

if (-not (Test-Path -LiteralPath $Script)) {
    Write-Log "FAIL: [launcher] script not found at $Script (repo moved? update `$Script in $PSCommandPath)"
    Show-Alert "Script not found: $Script"
    exit 1
}

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $Script
$code = $LASTEXITCODE
if ($code -ne 0) {
    Write-Log "FAIL: [launcher] run_daily_local.ps1 exited $code"
    Show-Alert "Exit $code. See $Log"
}
exit $code
