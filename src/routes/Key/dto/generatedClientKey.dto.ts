import { IsNotEmpty, IsUUID } from 'class-validator';

export class GenerateClientKey {
  @IsUUID(4)
  @IsNotEmpty()
  projectId: string;
}

/**
 * Resposta de exibicao unica.
 *
 * `privateKeyBase64` nunca e persistido nem registrado em log. Se esta
 * resposta se perder, a unica saida e revogar a chave e gerar outra.
 */
export class GeneratedClientKey {
  id: string;
  projectId: string;
  publicKeyPem: string;
  privateKeyBase64: string;
  warning: string;
}
