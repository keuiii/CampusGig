<?php

namespace App\Services;

use RuntimeException;

class PayoutDestinationCipher
{
    public function encrypt(string $value): string
    {
        $iv = random_bytes(12);
        $tag = '';
        $ciphertext = openssl_encrypt($value, 'aes-256-gcm', $this->key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($ciphertext === false || strlen($tag) !== 16) {
            throw new RuntimeException('Unable to encrypt payout destination');
        }

        return implode('.', array_map($this->base64UrlEncode(...), [$iv, $tag, $ciphertext]));
    }

    public function decrypt(string $value): string
    {
        $parts = explode('.', $value);
        if (count($parts) !== 3) {
            throw new RuntimeException('Invalid payout destination ciphertext');
        }
        [$iv, $tag, $ciphertext] = array_map($this->base64UrlDecode(...), $parts);
        if (strlen($iv) !== 12 || strlen($tag) !== 16 || $ciphertext === '') {
            throw new RuntimeException('Invalid payout destination ciphertext');
        }
        $plaintext = openssl_decrypt($ciphertext, 'aes-256-gcm', $this->key(), OPENSSL_RAW_DATA, $iv, $tag);
        if ($plaintext === false) {
            throw new RuntimeException('Unable to decrypt payout destination');
        }

        return $plaintext;
    }

    private function key(): string
    {
        $configured = (string) config('security.payout_destination_encryption_key', '');
        if ($configured === '') {
            throw new RuntimeException('PAYOUT_DESTINATION_ENCRYPTION_KEY is required');
        }

        return hash('sha256', $configured, true);
    }

    private function base64UrlEncode(string $value): string
    {
        return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
    }

    private function base64UrlDecode(string $value): string
    {
        $decoded = base64_decode(strtr($value, '-_', '+/'), true);
        if ($decoded === false) {
            throw new RuntimeException('Invalid payout destination ciphertext');
        }

        return $decoded;
    }
}
