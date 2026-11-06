param([ValidateRange(1, 65535)][int]$Port = 8787)
$ErrorActionPreference = 'Stop'
$entry = Join-Path $PSScriptRoot 'tools\serve.mjs'
Write-Host '自律型光背をこのPC内で開きます。表示されたURLをブラウザーで開いてください。'
Write-Host '音を始めるのは画面の「はじめる」。終了はこのウィンドウで Ctrl+C。'
& node $entry $Port
exit $LASTEXITCODE
