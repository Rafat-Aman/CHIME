from django.shortcuts import render

def uploads_view(request):
    return render(request, 'drive_integration/uploads.html')
