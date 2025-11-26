# config/settings.py
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
    "allauth.account.middleware.AccountMiddleware",
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
STATICFILES_STORAGE = "whitenoise.storage.CompressedManifestStaticFilesStorage"

MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# === Auth / Allauth ===
AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

LOGIN_REDIRECT_URL = env("LOGIN_REDIRECT_URL", default="/")
LOGOUT_REDIRECT_URL = env("LOGOUT_REDIRECT_URL", default="/")
ACCOUNT_EMAIL_VERIFICATION = env("ACCOUNT_EMAIL_VERIFICATION", default="optional")
# Map deprecated allauth settings to the newer `ACCOUNT_LOGIN_METHODS` and `ACCOUNT_SIGNUP_FIELDS`
_account_auth_method = env("ACCOUNT_AUTHENTICATION_METHOD", default="username_email")
_account_email_required = env.bool("ACCOUNT_EMAIL_REQUIRED", default=True)
_account_username_required = env.bool("ACCOUNT_USERNAME_REQUIRED", default=True)

if _account_auth_method == "username":
    ACCOUNT_LOGIN_METHODS = {"username"}
elif _account_auth_method == "email":
    ACCOUNT_LOGIN_METHODS = {"email"}
else:  # "username_email" or any other combined value
    ACCOUNT_LOGIN_METHODS = {"email", "username"}

ACCOUNT_SIGNUP_FIELDS = [
    "username*" if _account_username_required else "username",
    "email*" if _account_email_required else "email",
    "password1*",
    "password2*",
]

SOCIALACCOUNT_STORE_TOKENS = True
SOCIALACCOUNT_ADAPTER = env("SOCIALACCOUNT_ADAPTER", default="core.adapters.SocialAccountAdapter")

# === ✅ Google OAuth unified scopes ===
# config/settings.py

SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "SCOPE": [
            # Use ONLY full URLs. No "email", no "profile", no "openid".
            "https://www.googleapis.com/auth/userinfo.email",
            "https://www.googleapis.com/auth/userinfo.profile",
            "https://www.googleapis.com/auth/drive.file",
            "https://www.googleapis.com/auth/drive.metadata.readonly",
        ],
        "AUTH_PARAMS": {
            "access_type": "offline",
            "prompt": "consent",
            "include_granted_scopes": "true",
        },
    }
}

SESSION_EXPIRE_AT_BROWSER_CLOSE = env.bool("SESSION_EXPIRE_AT_BROWSER_CLOSE", default=True)

# === Email ===
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="webmaster@localhost")

# === Logging ===
LOG_LEVEL = env("LOG_LEVEL", default="INFO")
LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": LOG_LEVEL},
    "loggers": {
        "django.request": {
            "handlers": ["console"],
            "level": "WARNING",
            "propagate": True,
        },
    },
}

# === Security ===
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https") if env.bool("USE_X_FORWARDED_PROTO", default=False) else None
SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=not DEBUG and False)
SESSION_COOKIE_SECURE = env.bool("SESSION_COOKIE_SECURE", default=not DEBUG)
CSRF_COOKIE_SECURE = env.bool("CSRF_COOKIE_SECURE", default=not DEBUG)
SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=0 if DEBUG else 31536000)
SECURE_HSTS_INCLUDE_SUBDOMAINS = env.bool("SECURE_HSTS_INCLUDE_SUBDOMAINS", default=not DEBUG)
SECURE_HSTS_PRELOAD = env.bool("SECURE_HSTS_PRELOAD", default=not DEBUG)
X_FRAME_OPTIONS = env("X_FRAME_OPTIONS", default="DENY")

# === Custom user model ===
_custom_user_model = env("AUTH_USER_MODEL", default="")
if _custom_user_model:
    AUTH_USER_MODEL = _custom_user_model

# === REST Framework (optional) ===
if "rest_framework" in INSTALLED_APPS:
    REST_FRAMEWORK = {
        "DEFAULT_AUTHENTICATION_CLASSES": [
            "rest_framework.authentication.SessionAuthentication",
        ],
        "DEFAULT_PERMISSION_CLASSES": [
            "rest_framework.permissions.IsAuthenticatedOrReadOnly",
        ],
    }

# === CORS (optional) ===
if "corsheaders" in INSTALLED_APPS:
    MIDDLEWARE.insert(1, "corsheaders.middleware.CorsMiddleware")
    CORS_ALLOWED_ORIGINS = [o.strip() for o in env("CORS_ALLOWED_ORIGINS", default="").split(",") if o.strip()]
    CORS_ALLOW_ALL_ORIGINS = env.bool("CORS_ALLOW_ALL_ORIGINS", default=False)

# === Default primary key ===
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# === Upload proxy limits (Drive resumable chunks) ===
MAX_PROXY_CHUNK_BYTES = env.int("MAX_PROXY_CHUNK_BYTES", default=50 * 1024 * 1024)  # 50MB per proxied chunk
DATA_UPLOAD_MAX_MEMORY_SIZE = env.int("DATA_UPLOAD_MAX_MEMORY_SIZE", default=MAX_PROXY_CHUNK_BYTES)
FILE_UPLOAD_MAX_MEMORY_SIZE = env.int("FILE_UPLOAD_MAX_MEMORY_SIZE", default=MAX_PROXY_CHUNK_BYTES)
# How many Google Drive accounts a user can link for distributed uploads
MAX_DRIVE_ACCOUNTS = 5