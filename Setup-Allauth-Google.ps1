<#  Setup-Allauth-Google.ps1
    Idempotently configures django-allauth: Sites + Google SocialApp.
#>

param(
  [Parameter(Mandatory=$true)][string]$ClientId,
  [Parameter(Mandatory=$true)][string]$ClientSecret,
  [string]$Domain = "127.0.0.1:8000",
  [string]$DisplayName = "Local",
  [string]$AppName = "Google Local",
  [string]$PythonExe = "python",
  [string]$ManagePy = "manage.py"
)

if (!(Test-Path -Path $ManagePy)) {
  Write-Error "manage.py not found in $(Get-Location). Run this from your Django project root."
  exit 1
}

$env:ALLAUTH_DOMAIN        = $Domain
$env:ALLAUTH_DISPLAY       = $DisplayName
$env:ALLAUTH_CLIENT_ID     = $ClientId
$env:ALLAUTH_CLIENT_SECRET = $ClientSecret
$env:ALLAUTH_APP_NAME      = $AppName

# Python code we’ll feed via stdin (no emojis, ASCII only)
$py = @'
from django.conf import settings
from django.contrib.sites.models import Site
from allauth.socialaccount.models import SocialApp
import os

domain    = os.environ['ALLAUTH_DOMAIN']
display   = os.environ['ALLAUTH_DISPLAY']
client_id = os.environ['ALLAUTH_CLIENT_ID']
secret    = os.environ['ALLAUTH_CLIENT_SECRET']
app_name  = os.environ.get('ALLAUTH_APP_NAME', 'Google Local')

site_id = getattr(settings, 'SITE_ID', 1)
site = Site.objects.get(pk=site_id)
site.domain = domain
site.name = display
site.save()

app, _ = SocialApp.objects.get_or_create(provider='google', name=app_name)
app.client_id = client_id
app.secret = secret
app.key = ''
app.save()
app.sites.set([site])

print("OK: Site(id=%s, domain='%s', name='%s') configured." % (site.id, site.domain, site.name))
print("OK: SocialApp(id=%s, provider='%s', name='%s') configured and linked to Site %s."
      % (app.id, app.provider, app.name, site.id))
'@

try {
  # Ensure we're using the same interpreter as your venv if provided via -PythonExe
  & $PythonExe $ManagePy migrate
  if ($LASTEXITCODE -ne 0) { throw "Django migrate failed." }

  # Key change: pipe the code to stdin (PowerShell supports this)
  $py | & $PythonExe $ManagePy shell
  if ($LASTEXITCODE -ne 0) { throw "Django shell execution failed." }

  Write-Host "`nAll set. If warnings persist, verify INSTALLED_APPS and SITE_ID." -ForegroundColor Green
}
catch {
  Write-Error $_
  exit 1
}
