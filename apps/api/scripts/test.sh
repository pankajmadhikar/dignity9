#!/bin/sh
set -e
if [ -z "$CI" ]; then
  export DATABASE_URL="postgresql://apple@localhost:5432/dignity9_test?schema=public"
fi
cd "$(dirname "$0")/.."
npx prisma db push --skip-generate --accept-data-loss
npx vitest run
