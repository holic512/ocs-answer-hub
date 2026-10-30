# 数据库迁移与系统版本

## 日常使用

数据库连接仍然只需在 `.env` 填写 `DB_HOST`、`DB_PORT`、`DB_NAME`、`DB_USER`、`DB_PASSWORD`，不增加其他必填项。应用启动先执行 Prisma 版本迁移，成功后才对外提供服务。

- 空库：自动创建初始结构并记录迁移版本。
- 已迁移的库：只执行 `prisma/migrations` 中尚未应用的迁移，重复启动不会重复执行。
- 旧系统数据库：识别 `schema_migrations` 中的 `001-initial`，先校验结构，再建立 Prisma 基线；保留账号、题库、来源、凭证和历史数据。未安装扩展时缺失的可选模糊索引不阻止接管。
- 未知结构或迁移失败：停止启动，不执行重置；查看 `npm run db:status` 并核对迁移记录。

`prisma/schema.prisma` 是当前模型；`prisma/migrations` 是不可随意修改的版本历史；`prisma/baseline.prisma` 是旧版固定快照，不随业务模型更新。迁移记录保存在 `_prisma_migrations`，原 `schema_migrations` 作为旧系统记录保留。

Prisma 与原有 pg 共用连接池。来源的常规读写采用 Prisma ORM；题库模糊匹配、统计、事务锁和配额原子更新保留 PostgreSQL 专用 SQL。`pg_trgm` 由数据库管理员安装；可用时初始迁移创建模糊索引，未安装时保持原系统的降级行为。

## 开发新表结构

1. 在独立开发数据库修改 `prisma/schema.prisma`。
2. 运行 `npm run db:migration -- add_question_field` 生成待审查迁移；Prisma 开发迁移需要独立影子数据库权限，不在生产上运行。
3. 核对生成的 SQL，特别是字段删除、类型变化和默认值；需要保留的数据应通过显式 SQL 转换。
4. 运行 `npm run db:migrate` 应用待执行迁移，再运行 `npm run db:generate` 更新客户端。
5. 一并提交模型和迁移目录。已应用的迁移不再修改，新变更新增迁移。

`pg_trgm` 索引与 CHECK 约束包含手写 SQL，调整相关模型时需同步检查生成迁移。不要使用 `db push` 或 `migrate reset` 更新现有业务数据库。

## 部署升级

先备份数据库与 `state/master.key`，执行构建后再部署。Docker 镜像包含 Prisma 客户端、迁移工具、模型与迁移文件；启动会按顺序应用新迁移。也可以在启动前手动运行 `npm run db:migrate`，用 `npm run db:status` 查看状态。迁移账号需要相应的建表、改表权限。

迁移版本与应用版本分别记录：应用版本是 `1.0.0` 等版本号，数据库版本是按时间排序的迁移目录。发布包含哪些迁移由该提交内的迁移目录确定；不提供自动降级或自动删除业务数据。

## 系统版本规则

`package.json` 的 `version` 为唯一应用版本来源，初始为 `1.0.0`。后端 `/api/health` 返回此版本，前端构建时注入同一版本并显示在页脚。

| 当前版本 | 下一次提交 |
| --- | --- |
| 1.0.0 | 1.0.1 |
| 1.0.19 | 1.0.20 |
| 1.0.20 | 1.1.0 |
| 1.9.20 | 1.10.0 |

`x` 保持不变；每次提交递增 `z`，超过 20 时 `z` 归零、`y` 加一。

运行 `npm install` / `npm ci` 时，prepare 自动安装仓库内 `.githooks/pre-commit`；当前仓库已启用。已有自定义 hooksPath 时安装脚本停止并提示接入，不覆盖旧钩子。使用 `--ignore-scripts` 安装依赖后需手动运行 `npm run prepare` 和 `npm run db:generate`。

提交钩子根据 HEAD 版本计算下一版本，更新并暂存 `package.json` 与锁文件。提交失败重试不会重复累加；若这两个文件存在尚未暂存的修改，则先停止，避免把未准备提交的修改带入。

不要通过 `--no-verify` 或禁用钩子绕过此规则；Git 本地钩子无法约束主动绕过钩子的提交。提交成功后重新构建，发布产物才能显示新版本。系统版本递增不会改变数据库迁移历史。

## 验证

常规 `npm test` 覆盖版本进位及真实隔离 Git 提交。数据库集成测试和迁移测试必须串行运行，只使用专用 `_test` 库。

迁移测试使用 `MIGRATION_TEST=1`、`TEST_DB_NAME`、`TEST_DATABASE_RESET=1`，单独执行 `node --env-file=.env --import tsx --test tests/migrations.test.ts`；它会清空专用测试库，验证初始化、重复迁移、旧库接管、数据保留和后续版本更新。默认不运行该测试。
