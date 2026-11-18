# YMC Store — Kurulum Rehberi

Bu rehber, **YMC Store** uygulamasını Google Drive ve Google E-Tablolar (Sheets) veritabanınıza tamamen ücretsiz şekilde bağlamanız için hazırlanmıştır.

---

## Hazır Oluşturulan Google Kaynaklarınız

Sistem kurulumu sırasında hesabınızda şu kaynaklar otomatik oluşturuldu ve kodlara işlendi:

* **Google Drive Klasörü (`YMC Store`):** `1D2uUQD2dQOCjuQMrpCvprfyiKJTolzTe`
  *(APK dosyalarınızı buraya yükleyeceksiniz.)*
* **Google Sheets Veritabanı (`YMC Store DB`):** `1XbpgH2AqGqR1PNpS92AtlcgEqsa4oMUKPi9kZyMcxYc`
  *(Sayfalar: `Apps`, `Users`, `Reviews`, `Settings` — klasörün içindedir.)*

---

## Adım 1: Google Apps Script Arka Ucunu Yayınlayın (Zorunlu — ~2 dk)

1. [script.google.com](https://script.google.com) adresine gidin ve **Yeni Proje** açın.
2. Proje adını **YMC Store Backend** yapın.
3. Sol menüdeki `Kod.gs` dosyasının içini tamamen silin ve bu repodaki [`backend/Code.gs`](backend/Code.gs) dosyasının tüm içeriğini yapıştırın.
4. *(Önerilen)* Sol menüden **Proje Ayarları (⚙️)** > **"appsscript.json" manifest dosyasını düzenleyicide göster** kutusunu işaretleyin, ardından `appsscript.json` dosyasına [`backend/appsscript.json`](backend/appsscript.json) içeriğini yapıştırıp kaydedin (`Ctrl+S`).
5. Sağ üstten **Dağıt (Deploy) > Yeni Dağıtım (New deployment)** seçin:
   * **Tür:** Web uygulaması (Web app)
   * **Açıklama:** `v1`
   * **Şunun olarak çalıştır (Execute as):** **Ben (Me)**
   * **Kimlerin erişimi var (Who has access):** **Herkes (Anyone)**
6. **Dağıt**'a tıklayın, Google izin penceresinde **İzin Ver (Allow)** deyin.
7. Çıkan **Web Uygulaması URL'sini** (`https://script.google.com/macros/s/.../exec`) kopyalayın!

> **İpucu:** Bu URL'yi aldığınız anda yeni APK derlemesini beklemeden bile telefonunuzdaki YMC Store giriş ekranında **"⚙️ Bağlantı & Kurulum"** butonuna yapıştırarak mağazayı anında canlı kullanabilirsiniz! Kalıcı olarak tüm kullanıcılara dağıtmak için Adım 3'te `www/js/config.js` içine ekleyin.

---

## Adım 2: "Google ile Giriş" İçin OAuth 2.0 Ayarı (Ücretsiz — ~3 dk)

*Not: E-posta/Şifre ile Üye Ol ve Giriş Yap sistemleri Adım 1'den sonra **anında** çalışır. "Google ile Devam Et" butonunun Android'de açılması için aşağıdaki ücretsiz OAuth kimliklerini oluşturun:*

1. [Google Cloud Console — Kimlik Bilgileri](https://console.cloud.google.com/apis/credentials) sayfasını açın (yeni ücretsiz bir proje oluşturabilir veya mevcut bir projeyi seçebilirsiniz).
2. Eğer ilk kez açıyorsanız **OAuth İzin Ekranı (OAuth Consent Screen)** sekmesinden **Harici (External)** seçip uygulama adını `YMC Store` girerek kaydedin. (Test aşamasında **Yayın Durumu**'nu *Üretime Yayınla / Publish App* yaparsanız tüm kullanıcılar giriş yapabilir.)
3. **Kimlik Bilgileri Oluştur > OAuth İstemci Kimliği**:
   * **1) Web Uygulaması (Web application):**
     * Adı: `YMC Store Web`
     * Oluşan **Client ID**'yi kopyalayın (`123456...-xxxx.apps.googleusercontent.com`). Bu sizin `GOOGLE_WEB_CLIENT_ID` değerinizdir.
   * **2) Android:**
     * Adı: `YMC Store Android`
     * **Paket adı:** `com.erhan.ymcstore`
     * **SHA-1 sertifika parmak izi:** İlk GitHub Actions derlemesinin özet sayfasından veya uygulamanın içindeki **Kurulum / Hesabım** ekranından kopyaladığınız `SHA-1` değerini yapıştırın.

---

## Adım 3: Kalıcı Ayarları Repoya Ekleyin

1. [`www/js/config.js`](www/js/config.js) dosyasını açın:
   * `APPS_SCRIPT_URL`: Adım 1'deki `/exec` URL'nizi yazın.
   * `GOOGLE_WEB_CLIENT_ID`: Adım 2'deki Web Client ID'nizi yazın (isteğe bağlı olarak [`backend/Code.gs`](backend/Code.gs) içindeki `GOOGLE_WEB_CLIENT_ID` alanına da ekleyebilirsiniz).
2. Değişikliği `ymc-store` dalına pushladığınızda GitHub Actions otomatik olarak son güncel APK'yı derleyip artifact olarak sunacaktır.

---

## Adım 4 (Önemli): Sabit İmza Anahtarı (Keystore) Kullanımı

Her derlemede APK'nın `SHA-1` parmak izinin değişmemesi ve kullanıcıların uygulamayı silmeden güncelleme alabilmesi için GitHub Repo Ayarlarına (`Settings > Secrets and variables > Actions`) şu gizli anahtarları bir kez tanımlamanız önerilir:

1. Bilgisayarınızda tek seferlik keystore oluşturun:
   ```bash
   keytool -genkey -v -keystore ymcstore.keystore -alias ymcstore -keyalg RSA -keysize 2048 -validity 10000
   base64 -w0 ymcstore.keystore
   ```
2. GitHub Repository Secrets bölümüne ekleyin:
   * `YMC_KEYSTORE_B64`: Yukarıdaki base64 çıktısı
   * `YMC_KEYSTORE_PASS`: Belirlediğiniz keystore şifresi
   * `YMC_KEY_ALIAS`: `ymcstore`
   * `YMC_KEY_PASS`: Anahtar şifresi

---

## Yönetici Yetkisi

* Varsayılan yönetici e-postası `ymcerh@gmail.com` olarak tanımlıdır.
* Bu e-posta ile (Google ile veya Üye Ol üzerinden) giriş yaptığınızda alt menüde **🛠️ Yönetim** sekmesi otomatik açılır.
* Yönetim sekmesinden:
  * Telefondan doğrudan **Google Drive'a APK + İkon + Ekran Görüntüsü** yükleyebilir,
  * Bilgisayardan Drive'daki `YMC Store` klasörüne attığınız APK'ları **Tara & Forma Aktar** ile mağazaya ekleyebilir,
  * Yeni sürüm yayınlayıp kullanıcıların cihazında **Güncelle** butonunun çıkmasını sağlayabilirsiniz.
