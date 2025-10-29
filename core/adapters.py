from allauth.socialaccount.adapter import DefaultSocialAccountAdapter
from django.urls import reverse

class SocialAccountAdapter(DefaultSocialAccountAdapter):
    def get_connect_redirect_url(self, request, socialaccount):
        # After successfully connecting another Google account:
        return reverse("dashboard")
