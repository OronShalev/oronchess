# 🏗️ Hosting WintrChess locally

> This is a guide on how to get WintrChess running on your local machine.

## Prerequisites

- Git
- Node.js 22 or later
- Docker, if you want to host with that

## Setup

### Clone the repository

```sh
git clone https://github.com/wintrcat/wintrchess.git

# Go to the directory
cd wintrchess
```

### Set environment variables

These are the environment variables that you can set when hosting WintrChess:

```toml
NODE_ENV="production"
```

The environment that the app is running in. Can be one of two values: `production` (default) and `development`.

```toml
ALLOWED_HOSTNAMES="wintrchess.com,localhost"
```

A comma-separated list of hostnames the server will accept requests for (subdomains included). Requests with any other `Host` header get a `401 Unauthorized`. If unset, requests for any hostname are accepted.

```toml
PORT=8080
```

The port that the backend server listens on. Defaults to `8080`.

## Deploy manually

### Install dependencies

```sh
npm install
```

### Build the app

```sh
npm run build
```

You can also compile the server or the client on their own:

```sh
npm run build:server -w app
npm run build:client -w app
```

### Start the server

```sh
npm start
```

The server will begin listening on the port that you defined in the environment variables, or `8080` if you have not defined one.

## Deploy with Docker

You might find it easier to run WintrChess in a Docker container.

### Build and start

```sh
docker compose up
```
