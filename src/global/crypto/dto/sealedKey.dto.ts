/** Resultado do AES-256-GCM. Os tres campos sao base64 e vao juntos para o banco. */
export class SealedKey {
  cipher: string;
  iv: string;
  authTag: string;
}
