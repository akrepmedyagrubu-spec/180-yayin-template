# Wispbyte HLS Video Playlist

Bu uygulama, `playlist.txt` sırasındaki videoları tek bir FFmpeg sürecinde kesintisiz döndürür, logoları ekler, HLS (`.m3u8` + `.ts`) üretir ve Wispbyte'ın verdiği web portundan sunar. RTMP veya başka bir yayın platformu gerekmez.

## Dosyalar

- Videoları `videos/` içine koyun.
- Her video adını `playlist.txt` içine ayrı satır olarak yazın. Sıra oynatma sırasıdır.
- Reklam dosyasının adı tam olarak `reklam.mp4` olmalı. Bu klip oynarken `assets/reklam-logo.png` bütün görüntüyü kaplar.
- Diğer kliplerde `assets/yayin-logo.png` tüm ekranı kaplar.
- İki logo PNG olmalı. Şeffaf arka planlı yayın logosu tavsiye edilir.

Örnek:

```text
acilis.mp4
reklam.mp4
program.mp4
```

## En kısa kurulum

1. Zip'i açıp `videos/` içine videoları, `assets/` içine `reklam-logo.png` ve `yayin-logo.png` dosyalarını koyun.
2. `playlist.txt` içindeki örnek adları kendi video adlarınla değiştirin. `reklam.mp4` reklamın oynama sırasını belirler.
3. Bu klasörü GitHub'a yükleyin. Wispbyte'ta **Node.js** sunucusu oluşturup GitHub entegrasyonuyla repo'yu klonlayın.
4. Startup komutu `npm start` olsun ve sunucuyu başlatın. FFmpeg/ffprobe bağımlılık olarak gelir, ayrıca kurulum gerekmez.
5. Wispbyte public URL'sinden `/` sayfasını veya `/hls/index.m3u8` akışını açın.

Başka ayar gerekmez. Büyük videolar GitHub'a sığmıyorsa Wispbyte dosya yöneticisi/SFTP ile yükleyin. Ücretsiz planda 1 GB disk sınırı olduğunu hesaba katın.

## Video uyumluluğu ve akıcılık

FFmpeg, playlist'i tek bir canlı HLS akışına dönüştürür; her klipte yeni bir yayın bağlantısı açılmaz. Başlangıç ayarı 854×480, 25 FPS, H.264 ultrafast ve yaklaşık 1.1 Mbps video kullanır. `OUTPUT_WIDTH`, `OUTPUT_HEIGHT`, `OUTPUT_FPS` ve `VIDEO_BITRATE` değerleriyle değiştirebilirsiniz.

Concat demuxer'ın sorunsuz çalışması için playlist'teki videolar aynı video/ses codec'i, çözünürlük ve uyumlu stream yapısında olmalıdır (ör. tümü H.264 + AAC, 854×480). Farklı videolar hata verirse önce aynı teknik formata dönüştürün. Her klipte ses akışı bulunması da önerilir.

Wispbyte ücretsiz sunucusu 512 MB RAM, 1 GB disk ve sınırlı normal CPU ile geliyor; çok sayıda veya büyük video, ya da yüksek çözünürlüklü yazılımsal encode akıcı çalışmayabilir. Bu paket düşük çözünürlükte başlar; yük ölçümüne göre kaliteyi artırın. Public web portu/uzun süreli video trafiği hesabınızda kısıtlanırsa Wispbyte'ın plan ve fair-use koşulları belirleyicidir.

## Yerel çalıştırma

Node.js 18+ kurun, logo ve medya dosyalarını ekleyin, sonra:

```sh
npm install
npm start
```

Varsayılan adres `http://localhost:3000/`, HLS adresi `http://localhost:3000/hls/index.m3u8` olur.

## Ortam değişkenleri

`.env.example` örnek değerleri gösterir. Wispbyte ortam değişkenleri panelden ayarlanır; yerel kullanımda değerleri shell ortamına aktarın.

| Değişken | Varsayılan |
|---|---:|
| `PORT` | `3000` |
| `OUTPUT_WIDTH` / `OUTPUT_HEIGHT` | `854` / `480` |
| `OUTPUT_FPS` | `25` |
| `VIDEO_BITRATE` / `AUDIO_BITRATE` | `1100k` / `96k` |
| `HLS_SEGMENT_SECONDS` | `4` |
| `HLS_PLAYLIST_SIZE` | `8` |
| `AD_LOGO` / `BROADCAST_LOGO` | `assets/reklam-logo.png` / `assets/yayin-logo.png` |

Oynatma listesinde yalnızca dosya adları kullanılır; video dosyaları `videos/` içinde bulunmalıdır. FFmpeg veya dosya uyumsuzluğu hataları Wispbyte Console'da görünür.
