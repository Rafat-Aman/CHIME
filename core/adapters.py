# core/adapters.py
from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from allauth.account.adapter import DefaultAccountAdapter
from django.urls import reverse
import sys

# 1. Handle the Social Login Logic
class SocialAccountAdapter(DefaultSocialAccountAdapter):
    def get_connect_redirect_url(self, request, socialaccount):
        return reverse("dashboard")

    def save_user(self, request, sociallogin, form=None):
        # This runs during Auto-Signup.
        # If it fails, we want to know WHY.
        try:
            return super().save_user(request, sociallogin, form)
        except Exception as e:
            print(f"❌ SOCIAL ADAPTER CRASH: {e}", file=sys.stderr)
            raise e

    def authentication_error(self, request, provider_id, error=None, exception=None, extra_context=None):
            import sys
            # Print the error to the console
            print(f"❌ AUTHENTICATION ERROR: {error}", file=sys.stderr)
            if exception:
                print(f"❌ EXCEPTION: {exception}", file=sys.stderr)
                
            # DO NOT call super().authentication_error(...) - it doesn't exist!
            # Instead, just raise the exception so we see the yellow page
            if exception:
                raise exception
# 2. Handle the User Creation Logic (Auto-Signup)
class MyAccountAdapter(DefaultAccountAdapter):
    def is_open_for_signup(self, request):
        return True

    def save_user(self, request, user, form, commit=True):
        try:
            return super().save_user(request, user, form, commit)
        except Exception as e:
            print(f"❌ ACCOUNT ADAPTER CRASH: {e}", file=sys.stderr)
            raise e