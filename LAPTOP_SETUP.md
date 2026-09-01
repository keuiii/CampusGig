# CampusGig laptop setup

This guide moves CampusGig development to another Windows computer without committing passwords, OAuth secrets, uploaded files, or database contents to GitHub.

## 1. Install the required applications

- Git for Windows
- Node.js 24 LTS or a compatible current LTS release
- pnpm: `npm install -g pnpm`
- Docker Desktop using the installer that matches the laptop CPU (normally AMD64 for Intel/AMD Windows laptops)
- Android Studio, Android SDK, a Pixel emulator, and JDK 17
- VS Code and the Codex/ChatGPT desktop app as preferred

Restart Windows after installing Docker Desktop or Android virtualization components if requested.

## 2. Clone and install CampusGig

```powershell
git clone https://github.com/keuiii/CampusGig.git
cd CampusGig
pnpm install
cd api
pnpm install
cd ..\mobile
pnpm install
cd ..
```

## 3. Recreate private environment files

Copy the templates rather than copying credentials through GitHub:

```powershell
Copy-Item .env.example .env.local
Copy-Item api\.env.example api\.env
Copy-Item mobile\.env.example mobile\.env
```

Generate a new long random `JWT_SECRET`. If you restore the desktop database, securely copy the existing `MFA_ENCRYPTION_KEY` from the desktop `api/.env`; the administrator's saved authenticator setup is encrypted with that exact key. Generate a new MFA key only for a clean database or when all users will enroll again. Add the Google OAuth client IDs. Add the Gmail address and a newly generated Google App Password directly to `api/.env`; never paste secrets into chat or commit them.

For the Android emulator:

```env
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000
```

For a real phone, replace that value with the laptop's IPv4 address from `ipconfig`. Use the same address for email review links:

```env
EMAIL_ACTION_BASE_URL=http://LAPTOP_IPV4:4000
```

The laptop and phone must be on the same Wi-Fi while the backend is local. Add a Windows Firewall inbound rule for TCP port 4000 restricted to `LocalSubnet` when real-phone access is needed.

## 4. Start or restore PostgreSQL

Start Docker Desktop, then:

```powershell
docker compose up -d
pnpm db:generate
cd api
.\node_modules\.bin\prisma.CMD migrate deploy
cd ..
pnpm db:seed
```

This creates a clean database with the six service categories. To preserve the desktop administrator and current database instead, securely copy `D:\CampusGig\api\private-storage\backups\campusgig-laptop.backup` from the desktop to the laptop repository root and restore it before starting the apps:

```powershell
docker cp .\campusgig-laptop.backup campusgig-postgres:/tmp/campusgig-laptop.backup
docker exec campusgig-postgres pg_restore -U campusgig -d campusgig --clean --if-exists /tmp/campusgig-laptop.backup
```

Copy `api/private-storage` separately if uploaded avatars or documents need to move. Also transfer the required values from `api/.env` through a private method such as a USB drive or password manager—especially `MFA_ENCRYPTION_KEY` when restoring this backup. These files are intentionally ignored by Git and will not be included in the GitHub repository.

## 5. Google Sign-In on the laptop

The web OAuth client can keep the localhost origins already configured. A newly generated Android debug keystore may have a different SHA-1 certificate, so obtain the laptop SHA-1 and add or update the Android OAuth client in Google Cloud before testing native Google Sign-In.

## 6. Run CampusGig

Open separate terminals from the repository root:

```powershell
docker compose up -d
pnpm api:dev
pnpm dev
cd mobile
pnpm android
```

Web: `http://localhost:3000`

API health: `http://localhost:4000/api/v1/health`

## 7. First laptop verification

- API health returns `status: ok`
- Web marketplace loads categories and schools
- Administrator login opens the administrator dashboard
- Mobile registration receives a real email code
- Google login works on web and Android
- Password-change review links open on the intended device
- `pnpm check` passes

If this conversation is continued on the laptop, open the cloned CampusGig directory first so Codex can inspect that machine and finish any device-specific configuration.
