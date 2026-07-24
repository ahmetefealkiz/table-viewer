# Banka İşlem İzleme Botu (Chrome Uzantısı)

Bu proje, banka web arayüzlerinden hesap ve işlem (hareket) verilerini otomatik olarak okuyan, verileri mükerrer kontrolü yaparak **Google Sheets (E-Tablo)** üzerine senkronize eden ve oluşan hataları merkezi bir **Error Log** sekmesine raporlayan bir **Chrome Uzantısıdır (Manifest V3 Extension)**.

---

## 📌 İçindekiler
- [Mimari ve Çalışma Mekanizması](#-mimari-ve-çalışma-mekanizması)
- [Kesintisiz Çalışma (Anti-Sleep / Keep-Alive)](#-kesintisiz-çalışma-anti-sleep--keep-alive)
- [Proje Yapısı](#-proje-yapısı)
- [Kurulum ve Çalıştırma](#-kurulum-ve-çalıştırma)
  - [1. Chrome Uzantısının Yüklenmesi](#1-chrome-uzantısının-yüklenmesi)
  - [2. Google Sheets Entegrasyonu ve Yetkilendirme](#2-google-sheets-entegrasyonu-ve-yetkilendirme)
- [Kullanım ve Yapılandırma](#-kullanım-ve-yapılandırma)
- [Hata Kodları ve Açıklamaları (Error Codes)](#-hata-kodları-ve-açıklamaları-error-codes)
- [Google Sheets Tablo Yapısı](#-google-sheets-tablo-yapısı)

---

## 🏗 Mimari ve Çalışma Mekanizması

Sistem 3 temel uzantı katmanından oluşmaktadır:

```
+-------------------------------------------------------------------+
|                         Chrome Extension                          |
|                                                                   |
|  +-------------------+   +--------------------+   +-------------+ |
|  | Popup UI          |   | Content Script     |   | Background  | |
|  | (Ayarlar & Durum) | <-> (DOM / Web Kazıma) | <-> (Service    | |
|  +-------------------+   +--------------------+   |  Worker /   | |
|                                                   |  OAuth API) | |
|                                                   +------+------+ |
+----------------------------------------------------------|--------+
                                                           |
                                                           v
                                            +-----------------------------+
                                            |    Google Sheets API v4     |
                                            | (İşlem & Hata Log Tablosu)  |
                                            +-----------------------------+
```

### 1. Content Script (`content.js`)
* Banka web sayfasının DOM yapısını tarar.
* Belirtilen hesap numaralarını bulup hesap detay modalını/sayfasını çift tıklama simülasyonu ile açar.
* Hesap hareketleri tablosundan **Tarih**, **Açıklama**, **İşlem Referansı** ve **Alacak (Credit)** verilerini çıkarır.
* Sayfadaki para birimi kodunu (`OD_CCY_CODE`) otomatik algılar (bulamazsa varsayılan para birimini kullanır).
* Boş olan hesap tablolarını normal bir durum (0 kayıt) olarak ele alır, hata vermez.

### 2. Background Service Worker (`background.js`)
* Google OAuth2 oturum açma yetkilendirmelerini yönetir (`chrome.identity`).
* Google Sheets API v4 üzerinden bağlı E-Tabloya bağlanır.
* **Mükerrer Veri Kontrolü:** Eklenen işlemlerin **Referans (REF)** numaralarını kontrol ederek mükerrer kayıt atılmasını engeller. E-Tablo'daki son işlem web sayfasında bulunamazsa `ERR_DAT_002` hatası üretir.
* **Kesintisiz Çalışma (Anti-Sleep Engine):** Chrome Manifest V3 service worker'larının 30 saniye sonra uyumasını / durmasını engeller.

### 3. Popup Arayüzü (`popup.html` & `popup.js`)
* Kullanıcının izlenecek hesap numaralarını, hedef URL'yi, tablo başlık isimlerini ve yenileme sıklığını ayarlamasını sağlar.
* Bağlı Google E-Tablosunu, aktif durum takibini ve son senkronizasyon mesajlarını gösterir.
* Manuel tarama ("Taramayı Başlat") veya otomatik izleme modunu tetikler.

---

## ⏰ Kesintisiz Çalışma (Anti-Sleep / Keep-Alive)

Chrome Manifest V3 mimarisinde background servisleri (Service Worker) 30 saniye boşta kaldığında Chrome tarafından uyutulmaktadır. Botun 7/24 kesintisiz çalışması için 3 aşamalı **Keep-Alive** sistemi uygulanmıştır:

1. **`chrome.alarms` Zamanlayıcısı:** Her 30 saniyede bir tetiklenen arka plan alarmı ile Service Worker uyanık tutulur ve aktif izleme durumu denetlenir.
2. **Port Heartbeat (Kalp Atışı):** `content.js` ile `background.js` arasında sürekli açık tutulan `chrome.runtime.connect` portu üzerinden 20 saniyede bir ping atılır.
3. **Otomatik Yeniden Başlatma (Tab Wakeup):** Sekme yenilense veya tarayıcı arka plana geçse bile `sessionStorage` ve `chrome.storage.local` üzerinden izleme motoru otomatik olarak kaldığı yerden devam eder.

---

## 📁 Proje Yapısı

```bash
extension/                       # Chrome Uzantısı (Manifest V3)
├── manifest.json                # Uzantı konfigürasyonu ve yetkileri (alarms yetkisi dahil)
├── popup.html                   # Uzantı kullanıcı arayüzü
├── popup.css                    # Arayüz stilleri
├── popup.js                     # Arayüz mantığı ve kullanıcı etkileşimleri
├── content.js                   # Web kazıma (Scraping), DOM manipülasyonu & Port Heartbeat
└── background.js                # Service worker, Google API, Keep-Alive Alarms & arka plan servisleri
```

---

## ⚙️ Kurulum ve Çalıştırma

### 1. Chrome Uzantısının Yüklenmesi

1. Google Chrome tarayıcısını açın ve `chrome://extensions` adresine gidin.
2. Sağ üst köşedeki **Geliştirici modu (Developer mode)** anahtarını aktif edin.
3. **Paketlenmemiş öge yükle (Load unpacked)** butonuna tıklayın.
4. `extension` klasörünü seçin.
5. Uzantı başarıyla yüklenecektir.

### 2. Google Sheets Entegrasyonu ve Yetkilendirme

1. Tarayıcı simgesinden eklenti popup penceresini açın.
2. **Google ile Giriş Yap** butonuna basarak Google hesabınızı yetkilendirin.
3. Bağlanmak istediğiniz Google E-Tablo dosyasını seçin.
4. **Transaction (İşlem)** ve **Error Log** sekmelerini seçip kaydedin.

---

## 🔧 Kullanım ve Yapılandırma

Eklenti Popup arayüzündeki **Ayarlar** bölümünden aşağıdaki değerler yapılandırılabilir:

* **Hedef URL:** İzlenecek sayfanın adresi (Örn: `https://banka.com/hesap-hareketleri`).
* **İzlenecek Hesaplar:** Virgül ile ayrılmış hesap numaraları (Örn: `0514575556901, 0514575556902`).
* **Tablo Başlık İsimleri:** Banka tablosundaki sütun adları (Default: `Transaction Date`, `Narration`, `Transaction Reference`, `Credit`).
* **Varsayılan Para Birimi:** Sayfada bulunamazsa kullanılacak para birimi (Örn: `AED`, `USD`, `GBP`).
* **Yenileme Sıklığı:** Otomatik tarama aralığı (Dakika cinsinden).

---

## ⚠️ Hata Kodları ve Açıklamaları (Error Codes)

Sistemde meydana gelen hatalar standart kodlarla sınıflandırılır ve Google Sheets üzerindeki **Error Log** sayfasına otomatik kaydedilir:

| Hata Kodu | Hata Türü | Nedeni / Açıklaması | Çözüm Önerisi |
| :--- | :--- | :--- | :--- |
| `ERR_CFG_001` | Yapılandırma Hatası | Ayarlar kısmında geçerli bir Hedef URL tanımlanmamış veya URL formatı hatalı. | Popup ayarlarından geçerli bir Hedef URL girin. |
| `ERR_CFG_002` | URL Uyuşmazlığı | Açık olan sekmenin URL'si, Ayarlar'da tanımlanan Hedef URL'yi kapsamıyor. | Doğru banka sekmesinde olduğunuzdan emin olun. |
| `ERR_CFG_003` | Hesap Hatası | İzlenecek hesap numaraları girilmemiş. | Ayarlar kısmından en az bir hesap numarası ekleyin. |
| `ERR_DOM_001` | DOM Bulunamadı | Belirtilen hesap numarasına ait satır sayfada bulunamadı. | Hesap numarasının doğru olduğunu veya sayfanın yüklendiğini kontrol edin. |
| `ERR_DOM_002` | Başlık Bulunamadı | Tablo içerisinde aranan başlıkların (Date, Narration, Ref, Credit) hiçbiri tespit edilemedi. | Tablo başlık isimlerini Ayarlar bölümünden kontrol edin. |
| `ERR_DAT_001` | Veri / API Hatası | Google Sheets API'ye veri yazılırken veya bağlantıda bir hata oluştu. | Google oturumunuzu ve internet bağlantınızı kontrol edin. |
| `ERR_DAT_002` | Eşleşme Hatası | E-Tablo'da kayıtlı son işlem (referans) web sayfasından okunan hareketler arasında bulunamadı. | Web sayfasındaki tarih filtresini (Örn: "Last 7 days" yerine "Last 30 days") genişletip tekrar taratın. |
| `ERR_SYS_000` | Genel Sistem Hatası | Yakalanamayan bilinmeyen sistem hatası veya beklenmeyen durum. | Konsol günlüklerini (console logs) inceleyin. |

---

## 📊 Google Sheets Tablo Yapısı

Google Sheets üzerinde 2 adet sekme kurulmalıdır:

### 1. İşlem Kayıt Sekmesi (Transaction Sheet)
Banka hareketlerinin yazıldığı sekmedir:
- **Sütunlar:** `CURRENCY` | `DATE` | `NARRATION` | `TRANSACTION_REFERENCE` | `CREDIT`

### 2. Hata Log Sekmesi (Error Log Sheet)
Sistemde oluşan hataların kaydedildiği sekmedir. **Sütun sıralaması kesinlikle şu şekilde olmalıdır:**

```text
+---------------------+------------+---------------------------------------+
| TIMESTAMP           | ERROR_CODE | ERROR_DETAILS                         |
+---------------------+------------+---------------------------------------+
| 23.07.2026 15:10:00 | ERR_DOM_002| Tablo içerisinde belirtilen başlık... |
+---------------------+------------+---------------------------------------+
```

---

## 🛠 Lisans ve Geliştirme

Bu proje banka otomasyon süreçleri için geliştirilmiş bir Chrome Uzantısıdır.
