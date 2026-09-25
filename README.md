# Pi Java sandbox

Questa immagine Docker esegue [Pi](https://pi.dev/) in un container Linux con
Eclipse Temurin JDK 25. È pensata per lavorare su progetti Java/Spring basati
su Maven Wrapper (`./mvnw`), senza installare Maven globalmente.

Pi e i comandi che esegue nel container usano l'utente non privilegiato `node`.
Il progetto montato in `/workspace` resta invece modificabile: le modifiche
vengono scritte direttamente nella directory del computer host.

## Prerequisiti

- Docker Desktop avviato, in modalità Linux containers.
- Un abbonamento ChatGPT Plus/Pro con Codex e/o una chiave API di OpenCode Go.
- Un progetto Maven con `mvnw`, `mvnw.cmd` e `.mvn/wrapper/` se si vogliono
  eseguire build e test Java.

## Installare Pi e costruire l'immagine

Pi viene installato automaticamente nell'immagine durante la build; non è
necessario installarlo sul computer host.

Da questa directory:

```powershell
docker build -t pi-java-sandbox .
```

## Avviare Pi su un progetto Java

Apri PowerShell nella directory del progetto Java/Spring da analizzare e avvia:

```powershell
docker run --rm -it `
  -v "${PWD}:/workspace" `
  -v pi-agent-home:/home/node/.pi/agent `
  -v pi-maven-cache:/home/node/.m2 `
  pi-java-sandbox
```

I due volumi nominati mantengono fra avvii diversi le impostazioni e sessioni
di Pi (`pi-agent-home`) e la cache di Maven (`pi-maven-cache`). Non montare la
directory delle credenziali di Pi dell'host: il volume dedicato mantiene
separate le credenziali del container.

## Usare Codex e OpenCode Go

Al primo avvio, configura entrambi direttamente in Pi:

1. Esegui `/login openai-codex` e scegli **ChatGPT Plus/Pro (Codex
   Subscription)**; completa il flusso nel browser.
2. Esegui `/login opencode`, scegli l'autenticazione tramite API key e incolla
   la chiave di OpenCode Go.

Pi salva entrambi i login nel volume `pi-agent-home`, quindi gli avvii
successivi con lo stesso comando Docker li renderanno già disponibili. Con
`/model` puoi scegliere di volta in volta un modello `openai-codex/...` oppure
`opencode/...`.

Un abbonamento Codex non corrisponde a una `OPENAI_API_KEY`: quest'ultima usa
la fatturazione API separata. Non inserire chiavi o token nel Dockerfile né in
file versionati.

### Redirect OAuth Codex nel container

Non modificare il parametro `redirect_uri` dell'URL prodotto da Pi: deve
rimanere `http://localhost:1455/auth/callback`.

Il metodo più semplice è aprire l'URL di login nel browser dell'host; dopo il
login il browser proverà ad aprire `localhost:1455` e potrà mostrare un errore
di connessione. Copia l'intero URL finale dalla barra degli indirizzi e
incollalo nel prompt di Pi che richiede il codice o il redirect URL.

In alternativa, per ricevere il callback automaticamente, aggiungi questi due
argomenti **solo durante il login** al comando `docker run`:

```powershell
-p 127.0.0.1:1455:1455 `
-e PI_OAUTH_CALLBACK_HOST=0.0.0.0 `
```

La porta viene pubblicata soltanto sul loopback dell'host; non usare
`-p 1455:1455`, che la esporrebbe anche alla rete locale. Dopo che il login è
stato salvato nel volume `pi-agent-home`, non sono più necessari.

Una volta dentro Pi puoi verificare gli strumenti o eseguire i test:

```text
!java -version
!./mvnw --version
!./mvnw test
```

Il Maven Wrapper scarica autonomamente la versione di Maven definita dal
progetto. Se `./mvnw` non è eseguibile, assicurati che sia tracciato da Git con
permesso eseguibile e con terminazioni di riga LF:

```powershell
git update-index --chmod=+x mvnw
```

## Repository Maven aziendale

Se il progetto richiede mirror, credenziali o certificati definiti nel
`settings.xml` Maven dell'host, aggiungi al comando `docker run` questo mount
in sola lettura:

```powershell
-v "${env:USERPROFILE}\.m2\settings.xml:/home/node/.m2/settings.xml:ro"
```

Inseriscilo prima dell'ultimo argomento `pi-java-sandbox`.
