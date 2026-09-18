# Daily retail scrape, run on Art's PC via Windows Task Scheduler since
# 2026-07-23: Sainsbury's returns HTTP 403 to GitHub Actions runner IPs, so the
# hosted daily-scrape workflow can no longer scrape (its cron was removed; the
# check-freshness workflow emails if a day's data goes missing). This script
# does what the workflow's scrape/build/commit steps did, from a residential IP:
#   pull -> scrape (fail-loud preserved) -> build pages -> em-dash guard ->
#   commit (only if changed) -> push (deploy-pages workflow deploys on push).
# Log: %LOCALAPPDATA%\uk-food-scrape\scrape.log
# Task: "uk-food daily retail scrape", daily 09:00 local, StartWhenAvailable.

$RepoDir = 'C:\Users\akane\OneDrive\Dokumenti\Claude\Projects\uk-food_site'
$Node = 'C:\Program Files\nodejs\node.exe'
$Git = 'C:\Program Files\Git\cmd\git.exe'
$GitName = 'Arturs Kanepajs'
$GitEmail = '40496475+akanepajs@users.noreply.github.com'  # GH007: gmail address is rejected

$LogDir = Join-Path $env:LOCALAPPDATA 'uk-food-scrape'
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
$Log = Join-Path $LogDir 'scrape.log'

function Write-Log($msg) {
    Add-Content -Path $Log -Value "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) $msg" -Encoding utf8
}

# Run a native command via cmd so stderr never becomes a PowerShell error
# record; log its output; return $true on exit 0.
function Invoke-Step($tag, $exe, $cmdArgs) {
    $out = & cmd /c "`"$exe`" $cmdArgs 2>&1"
    $code = $LASTEXITCODE
    if ($out) { $out | ForEach-Object { Write-Log "  [$tag] $_" } }
    if ($code -ne 0) { Write-Log "FAIL: $tag exited $code"; return $false }
    return $true
}

Set-Location $RepoDir
$date = (Get-Date).ToUniversalTime().ToString('yyyy-MM-dd')
Write-Log "--- run start (UTC date $date) ---"

if (-not (Invoke-Step 'pull' $Git 'pull --rebase --autostash origin main')) { exit 1 }

# Scraper is fail-loud: exit 2 = retailer block, exit 1 = 3+ product failures.
# Either way nothing was written and we stop here; check-freshness will email.
Set-Location (Join-Path $RepoDir 'scraper')
if (-not (Invoke-Step 'scrape' $Node "run_scrape_uk.mjs $date")) { exit 1 }
Set-Location $RepoDir

if (-not (Invoke-Step 'build' $Node 'scripts\build_page.mjs')) { exit 1 }

# Em-dash guard (hard rule: none in outward-facing pages).
$emDashes = 0
foreach ($f in 'index.html', 'retail.html', 'wholesale.html') {
    $emDashes += ([regex]::Matches((Get-Content (Join-Path $RepoDir $f) -Raw -Encoding utf8), [char]0x2014)).Count
}
if ($emDashes -gt 0) { Write-Log "FAIL: $emDashes em dash(es) in generated HTML; not committing"; exit 1 }

if (-not (Invoke-Step 'add' $Git 'add -A')) { exit 1 }
& cmd /c "`"$Git`" diff --staged --quiet 2>&1"
if ($LASTEXITCODE -eq 0) { Write-Log 'No changes this run; done.'; exit 0 }

$commitArgs = "-c user.name=`"$GitName`" -c user.email=`"$GitEmail`" commit -m `"Daily price update $date (local scheduled task)`""
if (-not (Invoke-Step 'commit' $Git $commitArgs)) { exit 1 }

# Push; on rejection (e.g. the wholesale workflow pushed meanwhile) rebase and
# retry once.
if (-not (Invoke-Step 'push' $Git 'push origin main')) {
    if (-not (Invoke-Step 'pull-retry' $Git 'pull --rebase --autostash origin main')) { exit 1 }
    if (-not (Invoke-Step 'push-retry' $Git 'push origin main')) { exit 1 }
}
Write-Log 'OK: pushed; deploy-pages will publish.'
exit 0
