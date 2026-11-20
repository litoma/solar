// このファイルを secrets.h にコピーし、環境に合わせて設定してください。
//   cp secrets.example.h secrets.h
// ※ esp32s3/secrets.h は .gitignore で除外されています。

#pragma once

static const char* WIFI_SSID = "YOUR_SSID";
static const char* WIFI_PASS = "YOUR_PASSWORD";
static const char* API_TOKEN = "";   // 空なら認証なし。設定すると X-Api-Token ヘッダが必須になる
