import { IsNotEmpty, IsUUID } from 'class-validator';

export class GenerateClientKey {
  @IsUUID(4)
  @IsNotEmpty()
  projectId: string;
}

export class GeneratedClientKey {
  id: string;
  projectId: string;
  publicKeyPem: string;
  privateKeyBase64: string;
  warning: string;
}
