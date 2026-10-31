KongGate - desktop app
======================

In this folder:
  KongGate-win32-x64\        the app; run KongGate.exe inside it
  KongGate-<version>-win-x64.zip   the same folder as one file, to copy to other PCs
  database\                  what the ONE server needs: PostgreSQL in Docker

The app is the gateway and its screens in one program. It needs nothing
installed on the PC: no Docker, no Node.js, no internet. Only the database
lives on a server; every PC connected to it sees the same projects and works.

Shu papkada: ilova (KongGate.exe), uning zip nusxasi va bitta serverga
kerak bo'ladigan baza. Ilova - shlyuz va uning oynasi bitta dasturda.
Kompyuterga hech narsa o'rnatish shart emas: Docker ham, internet ham kerak
emas. Faqat baza serverda turadi; unga ulangan barcha kompyuterlar bir xil
loyiha va ishlarni ko'radi.


1. THE DATABASE, ONCE, ON THE SERVER / BAZA, BIR MARTA, SERVERDA
-----------------------------------------------------------------
Any PostgreSQL 12 or newer will do. Two ways:
Istalgan PostgreSQL 12 yoki undan yangisi bo'ladi. Ikki yo'l:

a) With Docker. Copy the "database" folder to the server and run in it:
   Docker bilan. "database" papkasini serverga ko'chiring va ichida bajaring:

       docker compose up -d

   The password is in database\.env (KONGGATE_DB_PASSWORD); the port is 5432.
   Parol database\.env faylida (KONGGATE_DB_PASSWORD); port 5432.

   No internet on the server? The image postgres:16-alpine is inside the older
   bundle's archive: docker load -i konggate-images.tar.gz
   Serverda internet bo'lmasa, postgres:16-alpine image'i avvalgi to'plam
   arxivida bor: docker load -i konggate-images.tar.gz

b) An existing PostgreSQL. Create a user and an empty database:
   Mavjud PostgreSQL. Foydalanuvchi va bo'sh baza yarating:

       CREATE USER konggate PASSWORD '...';
       CREATE DATABASE konggate OWNER konggate;

   and let the PCs in (postgresql.conf: listen_addresses; pg_hba.conf).
   va kompyuterlarga ruxsat bering (listen_addresses, pg_hba.conf).

The server's firewall has to let the database port in.
Server fayrvoli baza portiga ruxsat berishi kerak.


2. THE APP, ON EACH PC / ILOVA, HAR BIR KOMPYUTERDA
---------------------------------------------------
Unzip KongGate-<version>-win-x64.zip anywhere and run KongGate.exe.
Zip'ni istalgan joyga oching va KongGate.exe ni ishga tushiring.

The first start asks where the database is: the server's address, port 5432,
database "konggate", user "konggate" and the password. That is all.
Birinchi ishga tushganda baza qayerdaligi so'raladi: server manzili, port
5432, baza "konggate", foydalanuvchi "konggate" va parol. Bo'ldi.

The tables are created by the first app that connects.
Jadvallarni bazaga birinchi ulangan ilova o'zi yaratadi.


GOOD TO KNOW / BILIB QO'YING
----------------------------
- Clients send their requests to http://<this PC>:8100 . The port, and whether
  other PCs may call it, are on the app's Settings page. Windows may ask once
  to let KongGate through the firewall: allow it if other PCs should call.
  Mijozlar so'rovni http://<shu kompyuter>:8100 ga yuboradi. Port va boshqa
  kompyuterlarga ruxsat - ilovaning "Sozlamalar" sahifasida. Windows fayrvoli
  bir marta ruxsat so'rashi mumkin.

- Requests leave from this PC itself, like any program on it. A destination
  "http://localhost:8000" is a service on the very PC the app runs on.
  So'rovlar shu kompyuterning o'zidan chiqadi. "http://localhost:8000" -
  ilova ishlab turgan kompyuterdagi servis.

- Closing the window does not stop the gateway: the app stays in the tray
  (next to the clock). Right-click its icon and choose Quit to stop it.
  Oynani yopish shlyuzni to'xtatmaydi: ilova soat yonidagi belgida qoladi.
  To'xtatish uchun belgini o'ng tugma bilan bosib "Chiqish"ni tanlang.

- The administrator password is set by whoever opens "Admin kirishi" first,
  and is the same on every PC (it is kept in the database).
  Administrator parolini "Admin kirishi"ni birinchi ochgan kishi o'rnatadi;
  u barcha kompyuterlarda bir xil (bazada saqlanadi).

- Every PC holds the database password, so anyone who has it can read the
  database directly, JWT secrets included. The app never shows a secret's
  value, but it cannot stop that. Give the database password only to people
  who may know the secrets.
  Har bir kompyuterda baza paroli bor: uni bilgan kishi bazani, shu jumladan
  JWT secretlarni to'g'ridan-to'g'ri o'qiy oladi. Ilova secret qiymatini
  ko'rsatmaydi, lekin buni to'xtata olmaydi.

- This PC's settings and log file: %APPDATA%\KongGate
  Shu kompyuterning sozlamalari va log fayli: %APPDATA%\KongGate

- Not supported yet: WebSocket connections through the gateway.
  Hozircha yo'q: shlyuz orqali WebSocket ulanishlari.
