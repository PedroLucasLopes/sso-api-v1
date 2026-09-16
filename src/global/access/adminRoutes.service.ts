import { Injectable, RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { DiscoveryService, MetadataScanner, Reflector } from '@nestjs/core';
import { Method } from 'generated/prisma/enums';
import {
  SSO_LEVEL_AUTHENTICATED,
  SSO_LEVEL_PUBLIC,
} from '../constants/ssoLevel.constant';

export interface AdminRoute {
  path: string;
  method: Method;
}

const METHODS = new Set<string>(Object.values(Method));

/**
 * As rotas administrativas que este servidor de fato expoe, lidas do proprio
 * roteador.
 *
 * Servem a raiz. O SUPERADMIN do projeto `SSO` alcanca toda rota sem consultar
 * o catalogo, e o console precisa de uma lista para desenhar menu, abas e
 * acoes. Num ambiente novo o catalogo esta vazio: sem esta lista, a raiz
 * entraria num console sem nada justamente quando precisa cadastrar tudo.
 *
 * Nao e catalogo, nem arquivo de sincronia. Nao liga rota a papel nenhum e nao
 * vale para mais ninguem: os outros papeis continuam vendo so o que
 * `Permission` concede. Ficam de fora as rotas `@Public()` e
 * `@Authenticated()`, que nao passam por permissao.
 */
@Injectable()
export class AdminRoutesService {
  private routes: AdminRoute[] | null = null;

  constructor(
    private discovery: DiscoveryService,
    private scanner: MetadataScanner,
    private reflector: Reflector,
  ) {}

  /** Lida uma vez por processo: as rotas so mudam com deploy. */
  all(): AdminRoute[] {
    this.routes ??= this.discover();

    return this.routes;
  }

  private discover(): AdminRoute[] {
    const found = new Map<string, AdminRoute>();

    for (const wrapper of this.discovery.getControllers()) {
      const controller = wrapper.metatype;
      const instance: unknown = wrapper.instance;

      if (!controller || !instance || typeof instance !== 'object') continue;

      const prototype = Object.getPrototypeOf(instance) as Record<
        string,
        unknown
      >;
      const prefixes = this.pathsOf(
        this.reflector.get<unknown>(PATH_METADATA, controller),
      );

      for (const name of this.scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name];

        if (typeof handler !== 'function') continue;

        const verb = this.reflector.get<RequestMethod | undefined>(
          METHOD_METADATA,
          handler,
        );
        const suffixes = this.reflector.get<unknown>(PATH_METADATA, handler);

        if (verb === undefined || suffixes === undefined) continue;

        const levels = [handler, controller];

        if (
          this.reflector.getAllAndOverride<boolean>(SSO_LEVEL_PUBLIC, levels) ||
          this.reflector.getAllAndOverride<boolean>(
            SSO_LEVEL_AUTHENTICATED,
            levels,
          )
        ) {
          continue;
        }

        const method = RequestMethod[verb];

        if (!METHODS.has(method)) continue;

        for (const prefix of prefixes) {
          for (const suffix of this.pathsOf(suffixes)) {
            const path = this.join(prefix, suffix);

            found.set(`${method} ${path}`, { path, method: method as Method });
          }
        }
      }
    }

    return [...found.values()].sort((a, b) =>
      a.path === b.path
        ? a.method.localeCompare(b.method)
        : a.path.localeCompare(b.path),
    );
  }

  private pathsOf(value: unknown): string[] {
    if (Array.isArray(value)) return value.map((item) => String(item));

    return [typeof value === 'string' ? value : ''];
  }

  /** `project` e `:id/overview` viram `/project/:id/overview`, sem o prefixo global. */
  private join(prefix: string, suffix: string): string {
    const path = `/${prefix}/${suffix}`.replace(/\/{2,}/g, '/');

    return path.length > 1 ? path.replace(/\/+$/, '') : path;
  }
}
