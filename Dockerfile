FROM eclipse-temurin:25-jdk AS jdk

FROM node:24-bookworm-slim

ENV JAVA_HOME=/opt/java/openjdk
ENV PATH="${JAVA_HOME}/bin:${PATH}"

COPY --from=jdk /opt/java/openjdk /opt/java/openjdk

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git ripgrep unzip \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g --ignore-scripts @earendil-works/pi-coding-agent @fission-ai/openspec

RUN mkdir -p /workspace /home/node/.m2 /home/node/.pi/agent \
  && chown -R node:node /workspace /home/node

COPY --chmod=755 pi-packages.txt pi-entrypoint.sh /opt/
ENV HOME=/home/node
USER node

WORKDIR /workspace
ENTRYPOINT ["/opt/pi-entrypoint.sh"]
