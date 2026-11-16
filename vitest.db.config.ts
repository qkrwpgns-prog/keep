import { defineConfig } from 'vitest/config';
// 로컬 PostgreSQL(기본 postgres://postgres:postgres@localhost:5432)에 Supabase 흉내 장치 + 마이그레이션을 올려 RLS·두 계정 흐름을 검증한다.
export default defineConfig({
  test: { include: ['tests/db/**/*.test.ts'], globalSetup: ['tests/db/setup.ts'], environment: 'node', testTimeout: 30000, fileParallelism: false },
});
