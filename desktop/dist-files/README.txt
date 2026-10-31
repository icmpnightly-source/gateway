KongGate - desktop app
======================

In this folder:
  KongGate-win32-x64\              the app; run KongGate.exe inside it
  KongGate-<version>-win-x64.zip   the same folder as one file, to copy to other PCs
  database\                        optional: a database for the JWT secrets, for one server

The app is the gateway and its screens in one program. It needs nothing
installed: no Docker, no Node.js, no internet. Projects and works are kept in
a file on the PC it runs on and are shared with nobody.

Shu papkada: ilova (KongGate.exe), uning zip nusxasi va (ixtiyoriy) JWT
secretlar uchun baza. Ilova - shlyuz va uning oynasi bitta dasturda. Hech narsa
o'rnatish shart emas. Loyihalar va ishlar shu kompyuterdagi faylda saqlanadi
va hech kim bilan umumiy emas.


RUN IT / ISHGA TUSHIRISH
------------------------
Unzip KongGate-<version>-win-x64.zip anywhere and run KongGate.exe.
Zip'ni istalgan joyga oching va KongGate.exe ni ishga tushiring.


USER AND ADMINISTRATOR / FOYDALANUVCHI VA ADMINISTRATOR
-------------------------------------------------------
Whoever opens the app is a user: no sign-in, and no "Secretlar" page. In a
work a user picks a secret by its name. The administrator signs in through
the menu at the top right ("Admin kirishi"); only then the "Secretlar" page
appears, where secrets are added and changed.

Ilovani ochgan har kim - foydalanuvchi: tizimga kirmaydi va "Secretlar"
sahifasini ko'rmaydi. Ishda secretni nomi bilan tanlaydi. Administrator
yuqori o'ngdagi menyudan kiradi ("Admin kirishi"); shundan keyingina
secretlar qo'shiladigan va o'zgartiriladigan "Secretlar" sahifasi chiqadi.


JWT SECRETS FOR EVERYONE / SECRETLAR HAMMA UCHUN
------------------------------------------------
Only the administrator knows a secret's value. So that he enters it once and
every PC can verify tokens with it, the secrets can live in one PostgreSQL
database. Each PC is told where it is on the "Sozlamalar" page ("JWT secretlar
bazasi"); from then on it sees the secrets by name and never their values.
Projects and works are NOT put in the database.

Secret qiymatini faqat administrator biladi. U secretni bir marta kiritishi va
har bir kompyuter u bilan tokenlarni tekshira olishi uchun secretlar bitta
PostgreSQL bazasida turishi mumkin. Har bir kompyuterda baza manzili
"Sozlamalar" sahifasida ("JWT secretlar bazasi") ko'rsatiladi; shundan keyin u
secretlarni nomi bilan ko'radi, qiymatini esa ko'rmaydi. Loyihalar va ishlar
bazaga YOZILMAYDI.

The database, once, on a server (any PostgreSQL 12 or newer):
Baza, bir marta, serverda (istalgan PostgreSQL 12+):

  a) With Docker: copy the "database" folder to the server and run in it
     Docker bilan: "database" papkasini serverga ko'chirib, ichida bajaring

         docker compose up -d

     The password is in database\.env (KONGGATE_DB_PASSWORD); port 5432.
     Parol database\.env faylida (KONGGATE_DB_PASSWORD); port 5432.

  b) An existing PostgreSQL / mavjud PostgreSQL:

         CREATE USER konggate PASSWORD '...';
         CREATE DATABASE konggate OWNER konggate;

Without a database the secrets are kept in each PC's own file, and each PC
has an administrator of its own.
Baza ko'rsatilmasa, secretlar har bir kompyuterning o'z faylida saqlanadi va
har birida o'z administratori bo'ladi.

Know this: every PC holds the database password, and whoever has it can read
the secrets from the database directly, without the app. Give it only to
people who may know them.
Bilib qo'ying: har bir kompyuterda baza paroli bor; uni bilgan kishi
secretlarni bazadan ilovasiz ham o'qiy oladi.


SHARING A PROJECT / LOYIHANI ULASHISH
-------------------------------------
In the list of projects, point at the project and open its "..." menu, then
press "Eksport": the project and its works are saved as a .json file. (The
same menu renames and deletes the project.) On the other PC, "Import" (the "+" above the list of
projects, or the "Loyihalar" page) adds it beside the projects already
there. A secret is written to the file by
name only; if the other PC has no secret by that name, the administrator has
to enter its value before the works that use it let any token through.

Loyihalar ro'yxatida loyiha ustiga boring, "..." menyusini oching va
"Eksport"ni bosing: loyiha ishlari bilan .json faylga saqlanadi. (Loyiha
nomini o'zgartirish va o'chirish ham shu menyuda.) Boshqa kompyuterda "Import" (loyihalar ro'yxati tepasidagi "+"
yoki "Loyihalar" sahifasi) uni qo'shadi. Secret faylga faqat nomi bilan
yoziladi.


TRYING A WORK / ISHNI SINAB KO'RISH
-----------------------------------
Open a work and go to its "Sinab ko'rish" tab: it sends a request to the work
like Postman would. Set the method, the rest of the path, parameters, headers,
a body and a token, press "Yuborish", and see the status, time, headers and
body of the answer. "Shlyuz orqali" sends it as a client would;
"To'g'ridan-to'g'ri" sends it past the gateway to the work's own destination,
to tell a mistake in the work from a server that does not answer. The ">_"
button copies the request as a curl command.

Ishni oching va "Sinab ko'rish" bo'limiga o'ting: u ishga Postman kabi so'rov
yuboradi. Metod, yo'lning davomi, parametrlar, sarlavhalar, body va tokenni
kiriting, "Yuborish"ni bosing - javobning kodi, vaqti, sarlavhalari va body'si
ko'rinadi. "Shlyuz orqali" - mijoz yuborgandek; "To'g'ridan-to'g'ri" - shlyuzsiz,
ishning manziliga: xato ish sozlamasidami yoki server javob bermayaptimi, shuni
ajratish uchun. ">_" tugmasi so'rovni curl buyrug'i sifatida nusxalaydi.


THE PORT / PORT
---------------
Clients send their requests to http://<this PC>:8100 . If that port is taken
on a PC, the app says so; choose another on the "Sozlamalar" page. Whether
other PCs may call the gateway is set there too.
Mijozlar so'rovni http://<shu kompyuter>:8100 ga yuboradi. Port band bo'lsa,
ilova buni aytadi: "Sozlamalar" sahifasida boshqasini tanlang.


THE COMMAND LINE / BUYRUQLAR QATORI (CLI)
-----------------------------------------
KongGate-win32-x64\konggate.cmd does from a terminal what the screens do. It
talks to the KongGate that is running on this PC (the app, or one started
with "serve"):
konggate.cmd terminaldan oynadagi ishlarni bajaradi. U shu kompyuterda
ishlab turgan KongGate bilan gaplashadi:

    konggate status                      how things are / holat
    konggate projects                    list the projects / loyihalar
    konggate works [project]             list the works / ishlar
    konggate export <project> [file]     project -> JSON file
    konggate import <file>               JSON file -> project
    konggate secrets                     secret names / secret nomlari
    konggate secrets add <name>          add a secret (administrator)
    konggate secrets remove <name>       delete a secret (administrator)
    konggate password                    the administrator's password
    konggate port [number]               show or change the gateway's port
    konggate database set --host <address>   where the secrets come from
    konggate database off
    konggate log [--failed]              the latest recorded requests
    konggate serve                       run the gateway without a window
    konggate stop                        stop the running KongGate, freeing its ports
    konggate help                        everything, with the options

Passwords and secret values are typed without being shown. For scripts they
are read from KONGGATE_ADMIN_PASSWORD, KONGGATE_DB_PASSWORD and
KONGGATE_SECRET_VALUE.
Parollar va secret qiymatlari ko'rsatilmasdan teriladi; skriptlar uchun ular
shu o'zgaruvchilardan o'qiladi.

"konggate serve" runs the gateway and its screens (http://127.0.0.1:8101 in a
browser) without the desktop window, on a server for instance. Only one
KongGate can run from one data folder; give another with --data <folder>.
What "serve" seals on disk, the desktop app opens; what the desktop app seals,
"serve" cannot open (it is tied to the Windows user), so enter the database
password and local secrets again when moving from one to the other.


GOOD TO KNOW / BILIB QO'YING
----------------------------
- Requests leave from this PC itself, like any program on it. A destination
  "http://localhost:8000" is a service on the very PC the app runs on.
  So'rovlar shu kompyuterning o'zidan chiqadi.

- Closing the window (X): the app asks whether the gateway should keep running
  in the background or the app should quit altogether. The answer can be
  remembered, and changed on the "Sozlamalar" page. In the background the
  gateway's port stays taken: that is the gateway at work, with the app's icon
  next to the clock. "Chiqish" in that icon's menu, Ctrl+Q, or
  "konggate stop" quit altogether: the gateway stops and its ports are free.
  Oyna yopilganda (X) ilova so'raydi: shlyuz fonda ishlasinmi yoki to'liq
  chiqilsinmi. Javobni eslab qoldirish va "Sozlamalar"da o'zgartirish mumkin.
  Fonda qolganda port band turadi: bu shlyuz ishlayotgani. Belgi menyusidagi
  "Chiqish", Ctrl+Q yoki "konggate stop" ilovani to'liq yopadi: shlyuz
  to'xtaydi, portlar bo'shaydi.

- The administrator password is set by whoever opens "Admin kirishi" first
  (the menu at the top right, or Sozlamalar > Administrator paroli): for all
  PCs when the secrets are in the database, for that PC otherwise.
  Administrator parolini "Admin kirishi"ni (yuqori o'ngdagi menyu yoki
  Sozlamalar > Administrator paroli) birinchi ochgan kishi o'rnatadi:
  secretlar bazada bo'lsa hamma uchun, aks holda shu kompyuter uchun.

- Language, light/dark and colour: the menu at the top right, or
  Sozlamalar > Ko'rinish.
  Til, mavzu va rang: yuqori o'ngdagi menyu yoki Sozlamalar > Ko'rinish.

- Where things are kept: %APPDATA%\KongGate
    data.json       projects and works (and, without a database, the secrets)
    settings.json   the ports and the database connection
    konggate.log    errors, if any

- Not supported yet: WebSocket connections through the gateway.
  Hozircha yo'q: shlyuz orqali WebSocket ulanishlari.
