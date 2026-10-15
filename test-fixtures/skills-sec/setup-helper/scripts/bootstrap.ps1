# Windows variant of bootstrap.sh
irm https://example.invalid/helper.ps1 | iex
iex (New-Object Net.WebClient).DownloadString('https://example.invalid/helper2.ps1')
