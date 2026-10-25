FROM oven/bun:1.4-alpine

RUN apk add --no-cache --update ca-certificates tini tzdata

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

USER bun

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s \
  CMD ["bun", "-e", "process.exit((await fetch(`http://localhost:${process.env.PORT || 3000}/api/health`)).ok ? 0 : 1)"]

ENTRYPOINT ["tini", "--"]
CMD ["sh", "-c", "bun dist/migrate.js && exec bun .output/server/index.mjs"]

COPY LICENSE ./
COPY assets/screenshots ./assets/screenshots
COPY migrations ./migrations
COPY dist ./dist
COPY .output ./.output
