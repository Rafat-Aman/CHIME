from pathlib import Path
import os
import environ
from datetime import timedelta

# === Paths & env ===
BASE_DIR = Path(__file__).resolve().parent.parent
env = environ.Env(
    DEBUG=(bool, False),
)
# Load environment variables from .env next to manage.py if present
environ.Env.read_env(os.path.join(BASE_DIR, ".env"))

# === Core from .env ===
DEBUG = env("DEBUG", default=False)
SECRET_KEY = env("SECRET_KEY", default="insecure-secret-key")  # override in .env
ALLOWED_HOSTS = [h.strip() for h in env("ALLOWED_HOSTS", default="").split(",") if h.strip()]
TIME_ZONE = env("TIME_ZONE", default="UTC")
CSRF_TRUSTED_ORIGINS = [o.strip() for o in env("CSRF_TRUSTED_ORIGINS", default="").split(",") if o.strip()]

# === Base Django ===
INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "django.contrib.sites",

    # Third-party
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",

    # Your apps
    "core",
    "drive_integration",
]

SITE_ID = int(env("SITE_ID", default=1))

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "allauth.account.middleware.AccountMiddleware",  # <-- required by allauth
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "config.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = env("ASGI_APPLICATION", default=None) or None

# === Database ===
DATABASES = {
    "default": env.db(
        "DATABASE_URL",
        default=f"sqlite:///{(BASE_DIR / 'db.sqlite3').as_posix()}"
    )
}

# === Password validation ===
AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# === I18N / TZ ===
LANGUAGE_CODE = env("LANGUAGE_CODE", default="en-us")
TIME_ZONE = TIME_ZONE or "UTC"
USE_I18N = True
USE_TZ = True

# === Static & Media ===
STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"
STORAGES = {
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"}
}

# === Defaults ===
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# === Redirects & auth URLs ===
LOGIN_REDIRECT_URL = "dashboard"
LOGOUT_REDIRECT_URL = "home"
LOGIN_URL = "account_login"  # allauth login view

# === Email (dev) ===
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# === allauth options ===
ACCOUNT_SIGNUP_FIELDS = ["username*", "email*", "password1*", "password2*"]
ACCOUNT_EMAIL_VERIFICATION = "none"         # consider "mandatory" in prod
ACCOUNT_LOGIN_METHODS = {"email", "username"}
SOCIALACCOUNT_STORE_TOKENS = True           # store access/refresh tokens

# === ✅ Google OAuth unified scopes ===
SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "SCOPE": [
            "openid", "email", "profile",
            "https://www.googleapis.com/auth/drive.metadata.readonly"  # NEW
        ],
        "AUTH_PARAMS": {
            "access_type": "offline",  # ensures refresh tokens
            "prompt": "consent",       # always ask for re-consent
            "include_granted_scopes": "false",
        },
    }
}
SESSION_EXPIRE_AT_BROWSER_CLOSE = True
SOCIALACCOUNT_ADAPTER = "core.adapters.SocialAccountAdapter"

