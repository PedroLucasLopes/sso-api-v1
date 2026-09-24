-- Papel com nome livre. O enum so limitava os nomes a quatro; as permissoes
-- sempre foram linhas de "Permission". A conversao preserva os papeis atuais.
ALTER TABLE "Role" ALTER COLUMN "name" TYPE TEXT USING "name"::TEXT;

DROP TYPE "RoleEnum";

-- Todo projeto passa a ter os quatro papeis padrao. Nascem vazios: nenhuma
-- permissao e criada aqui, e rota continua sem acesso ate alguem liberar.
INSERT INTO "Role" ("id", "name", "projectId")
SELECT gen_random_uuid()::TEXT, padrao."name", projeto."id"
  FROM "Project" projeto
 CROSS JOIN (VALUES ('SUPERADMIN'), ('ADMIN'), ('MANAGER'), ('VIEWER')) AS padrao("name")
    ON CONFLICT ("name", "projectId") DO NOTHING;
