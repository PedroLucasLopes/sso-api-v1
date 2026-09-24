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

@Injectable()
export class AdminRoutesService {
  private routes: AdminRoute[] | null = null;

  constructor(
    private discovery: DiscoveryService,
    private scanner: MetadataScanner,
    private reflector: Reflector,
  ) {}

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

  private join(prefix: string, suffix: string): string {
    const path = `/${prefix}/${suffix}`.replace(/\/{2,}/g, '/');

    return path.length > 1 ? path.replace(/\/+$/, '') : path;
  }
}
