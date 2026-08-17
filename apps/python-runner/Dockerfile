FROM docker:29.6.2-cli-alpine3.24@sha256:be132a9f282288de4afaf63379dff75711fda0147c6b72a9df44e51841402144 AS docker-cli

FROM node:22.23.1-alpine3.24@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS problem-packager
WORKDIR /src
COPY scripts/package-python-runner-problems.mjs ./scripts/package-python-runner-problems.mjs
COPY problems/examples ./problems/examples
RUN node scripts/package-python-runner-problems.mjs problems/examples /runtime/problems/examples

FROM node:22.23.1-alpine3.24@sha256:16e22a550f3863206a3f701448c45f7912c6896a62de43add43bb9c86130c3e2 AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    PYTHON_RUNNER_PORT=8090 \
    PYTHON_RUNNER_PROBLEMS_ROOT=/app/problems/examples \
    TMPDIR=/var/lib/ai-code-dojo/python-runner-workspaces

RUN rm -rf \
      /usr/local/lib/node_modules/npm \
      /usr/local/bin/npm \
      /usr/local/bin/npx \
      /usr/local/bin/yarn \
      /usr/local/bin/yarnpkg \
      /opt/yarn-v* \
    && mkdir -p /var/lib/ai-code-dojo/python-runner-workspaces \
    && chmod 0700 /var/lib/ai-code-dojo/python-runner-workspaces

COPY --from=docker-cli /usr/local/bin/docker /usr/local/bin/docker
COPY apps/python-runner ./apps/python-runner
COPY packages/runner-sdk ./packages/runner-sdk
COPY --from=problem-packager /runtime/problems/examples ./problems/examples

RUN node --version \
    && docker --version \
    && test ! -e /usr/local/bin/npm \
    && test ! -e /usr/local/bin/yarn

EXPOSE 8090
CMD ["node", "apps/python-runner/src/server.mjs"]