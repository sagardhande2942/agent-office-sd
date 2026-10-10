> [!WARNING]
> **Work in progress.** Agent Office is built for one person's workflow — mine — and it changes fast as I iterate on it.
> Expect breaking changes between releases: keys that move, screens that get redrawn, features that come and go
> without notice. If it's close to what you want, fork or clone it and bend it into what you need it to be.

<div align="center">

*"Whatever you do, work heartily, as for the Lord and not for men."* — Colossians 3:23 (ESV)

# 🏢 Agent Office

**A 3D office your team shares with its coding agents.**

Before starting a worker, use **Build task brief** beside the prompt to organize a rough request
into a goal, examples, constraints and acceptance criteria. Review the editable preview and click
**Use brief**, then hire/send as usual. Choose **Manual** or **Draft with AI** (Claude Code or Codex
on the office server). Both modes work in 3D and Lite, preserve the original request, and start no
task worker while drafting. See [task briefs](docs/task-briefs.md).

The kitchen has a silver Samsung-style side-by-side fridge: **E** opens or closes both doors, and **C** takes a front-row Diet Coke while open. See [fridge controls](docs/features.md).

Full-screen agents retain up to 3,000 lines in the office's searchable, saved terminal scrollback. See [how it works](docs/how-it-works.md) for persistence and search behavior.

Sit **Claude Code**, **Codex**, **OpenCode**, **Grok**, **Muse**, **DeepSeek Harness** and **Cursor** workers at desks, watch each one's terminal on the laptop in front of it,
and jump into any of them together. Every GitHub repo is a floor of the building.

[![Release](https://img.shields.io/github/v/release/sagardhande2942/agent-office-sd?style=flat-square&color=e8c547&label=release)](https://github.com/sagardhande2942/agent-office-sd/releases)
[![Build](https://img.shields.io/github/actions/workflow/status/sagardhande2942/agent-office-sd/release.yml?style=flat-square&label=build)](https://github.com/sagardhande2942/agent-office-sd/actions)
[![License](https://img.shields.io/badge/license-MIT-blue?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](#run-locally)
[![Built with TypeScript](https://img.shields.io/badge/built%20with-TypeScript-3178c6?style=flat-square)](https://www.typescriptlang.org)

[**Run locally**](#run-locally) · [**Deploy to AWS**](#deploy-to-aws-ec2) · [**Azure**](#deploy-to-azure) · [**Railway**](#deploy-to-railway) · [**Fly.io**](#deploy-to-flyio) · [**Dokploy**](#deploy-to-dokploy) · [**Coolify**](#deploy-to-coolify) · [**Any server**](#deploy-to-any-ubuntu-or-debian-server) · [**Add users**](#add-users) · [**Controls**](#controls) · [**Features**](docs/features.md) · [**How it works**](docs/how-it-works.md) · [**Ideas**](docs/ideas.md)

```sh
curl -fsSL https://raw.githubusercontent.com/sagardhande2942/agent-office-sd/main/install.sh | bash
```

</div>

---

## What it is

- **Parallel worlds.** Explore three implementations of one task: **🌀 Parallel worlds** launches isolated agents from the same commit, with distinct approaches and branches. Gates appear while a variant is starting, working, or waiting for input; completed results remain in the menu. Enter a glowing portal in the Office map's south aisle to inspect its working preview, compare all three, give feedback and select a winner for a PR. See [docs/parallel-worlds.md](docs/parallel-worlds.md) for preview tunnels, requirements and preservation behavior.

- **A floor per project.** Ride the elevator, pick one of your GitHub repos, and the office clones it (showing how far along it is) and opens a floor for it. Every worker, board and queue on that floor works in that checkout.
- **Workers at desks.** Walk up to an empty desk, press **E**, and pick Claude Code, Codex, OpenCode, Grok, Muse, DeepSeek Harness, Pi, Cursor or Antigravity, each with its model and reasoning effort. The agent's live terminal shows on its laptop, and anyone can open it and type.
- **Talk instead of typing.** Hold **Ctrl+Space** (or the **🎤**) in a worker's terminal or a prompt box and say what you want: it's typed in for you to send. Your browser does the listening, so there's nothing to install.
- **You can't miss who needs you.** A worker that stops to ask you something lights a red beacon over its desk, puts a banner on your screen saying who and what for, and sounds an alarm. One that has finished jumps up and down and dings. Press **N** to go straight to the worker that has waited longest.
- **Agents that manage agents.** Every worker can list, hire, message and send home the others, through an `agent-office` MCP server (Claude Code, Codex, OpenCode) or the `office-workers` command. Ask one to "send everyone whose PR merged home" and it does, deleting their worktrees and branches unless they hold unpushed work. A worker that opens its pull request itself (`gh pr create`) shows it at its desk, and one the office missed can be told which is its own (`office-workers pr`).
- **A helper, when one is stuck.** Press **U** at a worker that's going in circles and a second agent walks over, stands at the desk with a laptop, re-reads the failure the first one can't see past, tells the worker what it found, and goes home. It works in that worker's own checkout and cannot edit, commit or open a pull request: the work never moves off the worker you're helping. The same shared walk starts when another agent requests help through `office-workers helper`, and refreshing a local floor restores its active helpers.
- **From your phone, too.** `/lite` is the Lite dashboard: every worker and what it's waiting on, its terminal with the keys a phone keyboard lacks, and the boards. The 3D office offers it on a phone or a slow computer.
- **GitHub or Bitbucket on the walls.** Issues and pull requests hang on cork boards, for the repository the checkout's `origin` points at (your own, for a fork). Hand an issue to a worker, queue tasks, give a worker its own git worktree and open its PR with one key (if one gets deleted behind the office's back, the worker waits at its desk until you rebuild it). One task can span several projects: the worker gets a worktree of each, and a PR in each that links the others.
- **Tracked worker communication.** Agents can queue requests, reply with branch/commit/file context, and acknowledge responses through persistent inboxes. Watch the exchanges in the CLI messages panel, `/lite` Messages, or the 3D menu. Workers read their inboxes between tasks; messages do not interrupt terminals. See [docs/communications.md](docs/communications.md).
- **Meeting messages:** review round-linked requests inside the meeting room, resolve outstanding handoffs before completion, or finish anyway with a recorded override. Communication snapshots stay with the saved meeting notes.
- **A manager that keeps an eye on the floor.** A **🧭 Manager agent** stands by the boards where the other board agents are, and reads the floor for itself: every worker with its task, status, pull request and what is blocking it (waiting on an answer, stalled, failed, out of desks), every queued task with the agent and model it runs on and whether its pull request and its checks verify it. It queues work with an agent and model you choose, holds a task back until another finishes, requeues what didn't land, and never calls anything done on a worker's say-so. Merging a pull request, deleting unfinished work and stopping anything in flight stay your decision: it asks. `office-workers status` prints the same report for you. Pick the agent it runs on in its kiosk window, like any other hire.
- **Together.** Voice, chat, a lounge TV that plays whatever video you paste a link to (or shows whoever's screen sharing) for everyone on the floor at once, a dance floor with disco lights in front of it that each person can put out from the TV window, and a shared whiteboard. There's a switch on the wall by that TV: throw it and the office's lights go down for the film.
- **A green, cosy office.** Plants everywhere you look: floor palms and a fiddle-leaf fig, peace lilies, pothos trailing off the desks and out of baskets hung from the ceiling, little pots on every window sill, herbs in the kitchen and window boxes along the balcony rail — with wood, wicker, terracotta and a warm floor lamp by the lounge.
- **You need looking after too.** Your energy and stress meters under the project name run down over fifty minutes and an hour and a quarter: your legs get heavy as the energy goes and your hands shake when you're wound up. A cup from the coffee machine in the kitchen puts the energy back, and so does a can of Diet Coke off the fridge's shelf (**C**, with the fridge open); a drink from the rooftop bar takes the stress off. Run either right out and you keel over on the floor and come round outside the building with both meters full. Bang the office gong and every bot on the floor gathers to dance a **🪕 Fugdi** together: rings of clapping, whirling dancers, and a turn together to finish.
- **Other maps.** Turn the whole building into a castle: sit on a throne of iron blades while your workers line up before you when they're done, send new ones off through the Hand of the King, and watch their beards grow long and grey as they toil. Send one home and the Kingsguard runs up from the dungeon, marches it down the stairs and throws it in a cell, where it starves, dies and rots down to a skeleton. Or into a space station in orbit, the Earth turning outside its windows: you run it from the captain’s chair on the bridge, and a worker sent home is marched to the airlock and blown out into space, to drift off past the observation windows with everyone who went before it. Or turn it into **🌃 Night City**: a rain-slick neon concourse of holographic billboards, vending machines and LED strips, console benches under a steel gantry, the city towers and rain beyond the glass, and a terrace over the street you can walk out onto. Or make a map of your own, with its own way of seeing workers off in JSON ([docs/maps.md](docs/maps.md)).

There's a lot more (a rooftop bar, an office dog, an arcade, a fridge stocked with Diet Coke and ice creams, supercars in the garage to drive round a scenic loop past a farm, pines, mountains and a beach): see [docs/features.md](docs/features.md).

## Requirements

On the machine that runs the office:

- **Node.js 20+**
- At least one agent CLI, signed in as the user that runs the office: **Claude Code** (`claude`), **Codex** (`codex`), **OpenCode** (`opencode`), **Grok** (`grok`), **Muse** (`muse`), **DeepSeek Harness** (`dsh`), **Pi** (`pi`, 0.87.1+), the **Cursor** CLI (`cursor-agent`) or **Antigravity CLI** (`agy`). With [accounts](#add-users), everyone can sign in to their own Claude from the office instead.
- **git**, and a forge CLI for cloning repos and the issue and PR boards: the **GitHub CLI** (`gh auth login`) for GitHub projects, or the [Bitbucket CLI](https://bitbucket-cli.paulvanderlei.com) (`bb`, `npm install -g @pilatos/bitbucket-cli`) for Bitbucket ones. Each floor works out which one from its own remote, so you can use GitHub, Bitbucket or both. Two different tools answer to `bb`: if the one on your machine is [Atlassian's own Bitbucket CLI](https://bitbucket.org/atlassianls/bitbucket-cli) rather than the one above, the office says so by name instead of failing with `unknown flag: --json`.

## Run locally

Install the latest release and start the office:

```bash
curl -fsSL https://raw.githubusercontent.com/sagardhande2942/agent-office-sd/main/install.sh | bash
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/sagardhande2942/agent-office-sd/main/install.ps1 | iex
```

This puts an `agent-office` command on your PATH, so next time just run `agent-office`. Run the install line again to update. The installer's settings (a particular release, install without starting) are listed at the top of [`install.sh`](install.sh) and [`install.ps1`](install.ps1).

The first time it starts, it walks you through setting up, right in the terminal:

1. **Where to clone your projects.** It suggests a code folder you already have (`~/Workspace`, `~/code`…), else `~/agent-office`. Each project goes in `<folder>/<owner>/<repo>`.
2. **GitHub and Bitbucket.** For each one whose CLI is installed but not signed in, it offers to run the sign-in for you. Either one is enough to go on; the projects it offers are the ones that login can see. On Bitbucket, `bb auth login` also records the workspace to work in by default, which is how the office lists a personal workspace's repositories — those can't be reached by naming the workspace, since a personal workspace's slug is usually not your username.
3. **Your first project.** Pick one of your repos by number, or type `owner/name`, and the office clones it as the first floor.

Press Enter to skip a step: the elevator in the office asks for your first project too. Then the office opens in your browser, **already signed in**, with a link that works once. The terminal also prints the office password, for signing in from another browser (it's saved in `~/agent-office/.agent-office/config.json`).

Walk to an empty desk, press **E** and hire a worker.

Common options:

```bash
agent-office ~/code/my-project              # use a project you already have as the first floor
agent-office --password 'correct horse'     # choose the password
agent-office --port 4700
agent-office --agent pi                     # default agent: claude, codex, opencode, grok, muse, dsh, pi, cursor-agent or agy
agent-office --no-open                      # print the sign-in link instead of opening a browser
agent-office tui                            # join the running office from your terminal
agent-office setup                          # the first-start walkthrough again (office stopped)
```

For a terminal-only client, start the office with `agent-office --no-open`, then run `agent-office tui` in another terminal. Its live desk grid shares floors, workers and terminals with the 3D and lite views: use arrows to select a desk, Enter to open it, and Tab for boards. See [docs/cli.md](docs/cli.md) for commands and remote connections, or [cmd.txt](cmd.txt) for a copyable command and flag reference.

The plant beside the basketball uses the optimized 278 KB `src/client/models/basketball-plant.glb`. Replace that file and rebuild to change this single plant; Draco-compressed GLBs use a locally bundled decoder. See [custom plant models](docs/features.md#custom-plant-model).

Every option is in [docs/configuration.md](docs/configuration.md). Choosing models and providers per worker is in [docs/agents.md](docs/agents.md).

To run it from a clone instead:

```bash
git clone https://github.com/sagardhande2942/agent-office-sd && cd agent-office-sd
npm install          # also builds the client and server
npm install -g .     # puts `agent-office` on your PATH
agent-office
```

> Only your computer can reach the office: it listens on `127.0.0.1`. `--host 0.0.0.0` lets your network in, but over plain http, where voice and screen sharing don't work. To share the office with a team, put it on a server: [AWS](#deploy-to-aws-ec2), [Azure](#deploy-to-azure), [Railway](#deploy-to-railway), [Fly.io](#deploy-to-flyio), [Dokploy](#deploy-to-dokploy), [Coolify](#deploy-to-coolify) or [any Ubuntu or Debian machine](#deploy-to-any-ubuntu-or-debian-server).

## Deploy to AWS (EC2)

One script, using only the AWS CLI. You need the **AWS CLI signed in** (`aws configure` or `aws sso login`), `ssh`, `curl` and a clone of this repo:

```bash
git clone https://github.com/sagardhande2942/agent-office-sd && cd agent-office-sd
deploy/aws.sh up --project your-org/your-repo --claude-token "$(claude setup-token)"
```

In about two minutes, `up`:

1. Launches a **t3.xlarge** (4 vCPU, 16 GiB) Ubuntu 24.04 instance with a 50 GiB disk and a fixed Elastic IP.
2. Creates a security group that opens **only SSH, only to your IP**. The office listens on `127.0.0.1:4600` on the machine and is never on the internet. Everyone reaches it through an SSH tunnel, so there are no certificates to manage, and voice and screen sharing work.
3. Runs [`deploy/provision.sh`](deploy/provision.sh) on it: Node 22, git, the GitHub CLI, the Bitbucket CLI, Claude Code and the office, under systemd, so it comes back after a crash or reboot and workers keep running through a restart.
4. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

`--project` is optional: it clones that repo as the first floor. Leave it out and pick projects in the elevator.

**Signing in the agents.** `--claude-token` uses your Claude subscription; `--anthropic-api-key <key>` uses an API key instead. Leave both out and run `/login` in the first worker's terminal. Codex and OpenCode aren't installed by the script: `deploy/aws.sh ssh` and install them yourself.

**GitHub.** Your local `gh auth token` is copied to the machine so the office can clone private repos, show the boards and push PRs. Anyone in the office can use it, so pass `--github-token <fine-grained token>` or `--no-github-token` to limit that. Bitbucket is signed in separately, by hand on the machine (`bb auth login`), and the same `--github-token` / `--no-github-token` switches cover it.

**On Tailscale, no tunnels.** If your team uses [Tailscale](https://tailscale.com), add `--tailscale`:

```bash
deploy/aws.sh up --tailscale --project your-org/your-repo --claude-token "$(claude setup-token)"
```

The machine joins your tailnet, and Tailscale Serve puts the office on `https://agent-office.<your-tailnet>.ts.net` with a real certificate. Anyone on your tailnet just opens that link: no terminal to keep open, no SSH keys, no IPs to allow, and voice and screen sharing work. `up` opens Tailscale's page to add the machine (or pass `--tailscale-auth-key tskey-auth-…`) and, the first time, the page that turns on HTTPS for your tailnet. SSH stays open to your IP only, for `deploy/aws.sh` itself. More in [docs/aws.md](docs/aws.md#tailscale).

Day to day:

```bash
deploy/aws.sh open                # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/aws.sh status              # machine, address, is the office up, who's invited
deploy/aws.sh logs                # follow the office's logs
deploy/aws.sh ssh                 # a shell on the machine
deploy/aws.sh update              # install the latest agent-office and restart
deploy/aws.sh resize t3.2xlarge   # bigger or smaller machine, same address
deploy/aws.sh pause               # stop the machine; only the disk and IP are billed
deploy/aws.sh resume              # start it again and open it
deploy/aws.sh destroy             # delete everything it created (asks first)
```

You can also upgrade from inside the office: **☰ → ⬆️ Upgrade the office**. Other flags (`--region`, `--instance-type`, `--disk`, `--name` for several offices) are in `deploy/aws.sh help`, and the details are in [docs/aws.md](docs/aws.md).

**The workers' dev servers, on your computer.** The office runs on the server, so a worker's `npm run dev` listens there. Run this on your own computer and leave it running, and every web server a worker starts opens on the same port on yours, by itself (`http://localhost:5173` is the worker's), and closes when the worker stops it:

```bash
agent-office tunnel                       # while `deploy/aws.sh open` (or a teammate's ssh command) is running
agent-office tunnel office@203.0.113.7    # or by itself: it opens the tunnel to the office too
```

It works with every way of running the office on a server, and needs the `agent-office` command on your computer: [docs/tunnel.md](docs/tunnel.md).

## Deploy to Azure

The same thing on an Azure VM, using only the Azure CLI. You need the **Azure CLI signed in** (`az login`), `ssh`, `curl` and a clone of this repo:

```bash
git clone https://github.com/sagardhande2942/agent-office-sd && cd agent-office-sd
deploy/azure.sh up --project your-org/your-repo --claude-token "$(claude setup-token)"
```

`up` puts everything in a resource group of its own, `agent-office`, and launches a **Standard_D4as_v5** VM (4 vCPU and 16 GiB, like the t3.xlarge on AWS, at about the same price) with Ubuntu 24.04, a 64 GiB Premium SSD and a static IP. Its firewall opens **only SSH, only to your IP**. Then it runs the same [`deploy/provision.sh`](deploy/provision.sh) and opens the office through an SSH tunnel at http://localhost:4600. **The first page shows the office password once. Write it down.**

Every command from the AWS script works the same, with `deploy/azure.sh` in its place: `open`, `status`, `logs`, `ssh`, `update`, `invite`, `allow`, `service`, `resize Standard_D8as_v5`, `pause` (deallocates the VM, so only the disk and IP are billed), `resume` and `destroy` (deletes the resource group). One more, `connect`, lets a second computer manage the office. `--location` picks the region (default: your `az` default location, else `eastus`), `--subscription` the subscription and `--size` the VM size. The details are in [docs/azure.md](docs/azure.md).

## Deploy to Railway

No machine to look after: one script, using the Railway CLI. You need the **Railway CLI 5 or newer, logged in** (`railway login`), `ssh`, `curl`, Node.js and a clone of this repo:

```bash
git clone https://github.com/sagardhande2942/agent-office-sd && cd agent-office-sd
deploy/railway.sh up --claude-token "$(claude setup-token)"
```

In about five minutes, `up`:

1. Creates a Railway project with one service, built from this checkout with [`deploy/container/Dockerfile`](deploy/container/Dockerfile): Node 22, git, the GitHub CLI and sshd, with Claude Code installed on first start.
2. Adds a **volume on `/data`** for everything the office keeps: the password, accounts, floors and settings, the projects, Claude's and GitHub's sign-ins, teammates' keys and the SSH host key. Restarts and redeploys replace the container, never the volume.
3. Puts Railway's **TCP proxy** in front of the container's SSH, and nothing else. The office listens on `127.0.0.1:4600` inside the container and has no public URL: everyone reaches it through an SSH tunnel, as on AWS.
4. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

The agents and GitHub sign in as on AWS: `--claude-token`, `--anthropic-api-key`, `--github-token` or `--no-github-token`.

```bash
deploy/railway.sh open              # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/railway.sh status            # deployment, SSH address, volume, is the office up, who's invited
deploy/railway.sh invite octocat    # let a teammate tunnel in with their GitHub SSH keys
deploy/railway.sh logs              # follow the office's logs (ssh: a shell in the container)
deploy/railway.sh update            # build this checkout again and redeploy it
deploy/railway.sh destroy           # delete the project and its volume (asks first)
```

The details, and what's on the volume, are in [docs/railway.md](docs/railway.md).

## Deploy to Fly.io

The same container on a [Fly.io](https://fly.io) machine, using flyctl. You need **flyctl logged in** (`fly auth login`), `ssh`, `curl`, Node.js and a clone of this repo:

```bash
git clone https://github.com/sagardhande2942/agent-office-sd && cd agent-office-sd
deploy/fly.sh up --claude-token "$(claude setup-token)"
```

In a few minutes, `up`:

1. Creates a Fly app with one machine, a `shared-cpu-4x` with 8 GB in the region nearest you, built from this checkout with the same [`deploy/container/Dockerfile`](deploy/container/Dockerfile) as on Railway.
2. Adds a **volume on `/data`** for everything the office keeps, so restarts, redeploys and resizes lose none of it.
3. Gives the app a **dedicated IPv4 address** with SSH on a random port, and nothing else. The office listens on `127.0.0.1:4600` inside the machine and has no public URL: everyone reaches it through an SSH tunnel, as on AWS.
4. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

The agents and GitHub sign in as on AWS: `--claude-token`, `--anthropic-api-key`, `--github-token` or `--no-github-token`.

```bash
deploy/fly.sh open                    # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/fly.sh status                  # machine, SSH address, volume, is the office up, who's invited
deploy/fly.sh invite octocat          # let a teammate tunnel in with their GitHub SSH keys
deploy/fly.sh logs                    # follow the office's logs (ssh: a shell in the machine)
deploy/fly.sh update                  # build this checkout again and redeploy it
deploy/fly.sh resize performance-2x   # another machine size, same address and volume
deploy/fly.sh pause                   # stop the machine (resume starts it again)
deploy/fly.sh destroy                 # delete the app and its volume (asks first)
```

`--region`, `--org`, `--vm-size`, `--memory`, `--disk` and `--name` (for several offices) are in `deploy/fly.sh help`. The details, and what's on the volume, are in [docs/fly.md](docs/fly.md).

## Deploy to Dokploy

Already run a [Dokploy](https://dokploy.com) server? One script puts the office on it, through Dokploy's API. You need an **API key** (Dokploy: **Settings → Profile → API/CLI Keys**, with rate limiting off), `ssh`, `curl`, `git`, Node.js and a clone of this repo:

```bash
git clone https://github.com/sagardhande2942/agent-office-sd && cd agent-office-sd
export DOKPLOY_API_KEY=<your key>
deploy/dokploy.sh up --url https://dokploy.example.com --claude-token "$(claude setup-token)"
```

In about five minutes, `up`:

1. Creates a Dokploy project with one application, and uploads this checkout for Dokploy to build with [`deploy/container/Dockerfile`](deploy/container/Dockerfile), the same image as on Railway.
2. Mounts a **Docker volume on `/data`** for everything the office keeps. Deploys and restarts replace the container, never the volume.
3. Publishes the container's SSH on **port 2222 of the server** (`--ssh-port` picks another), and nothing else: no domain, and the office listens on `127.0.0.1:4600` inside the container. Everyone reaches it through an SSH tunnel, as on AWS. A firewall in front of the server has to let that port through.
4. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

The agents and GitHub sign in as on AWS: `--claude-token`, `--anthropic-api-key`, `--github-token` or `--no-github-token`. `--server <name>` runs it on one of Dokploy's remote servers.

```bash
deploy/dokploy.sh open              # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/dokploy.sh status            # its page in Dokploy, last deployment, SSH address, who's invited
deploy/dokploy.sh invite octocat    # let a teammate tunnel in with their GitHub SSH keys
deploy/dokploy.sh logs              # follow the office's logs (ssh: a shell in the container)
deploy/dokploy.sh update            # upload this checkout again, build it and redeploy it
deploy/dokploy.sh destroy           # delete the application and its volume (asks first)
```

The details, and what's on the volume, are in [docs/dokploy.md](docs/dokploy.md).

## Deploy to Coolify

Already run a [Coolify](https://coolify.io) server? One script puts the office on it, through Coolify's API. You need **API Access** turned on (Coolify: **Settings → Configuration → Advanced**), an **API token** with read, write and deploy (**Keys & Tokens → API tokens**), `ssh`, `curl`, `git`, Node.js and a clone of this repo. Coolify builds from git, so the commit you deploy has to be pushed to a public repository: by default, the upstream of your branch.

```bash
git clone https://github.com/sagardhande2942/agent-office-sd && cd agent-office-sd
export COOLIFY_API_TOKEN=<your token>
deploy/coolify.sh up --url https://coolify.example.com --claude-token "$(claude setup-token)"
```

In about five minutes, `up`:

1. Checks that this checkout's HEAD is on its upstream branch (or on `--repo` and `--branch`), and tells you what to push if it isn't.
2. Creates a Coolify project with one application, and has Coolify build that commit with [`deploy/container/Dockerfile`](deploy/container/Dockerfile), the same image as on Railway.
3. Mounts a **Docker volume on `/data`** for everything the office keeps. Deploys and restarts replace the container, never the volume.
4. Publishes the container's SSH on **port 2222 of the server** (`--ssh-port` picks another), and nothing else: no domain, and the office listens on `127.0.0.1:4600` inside the container. Everyone reaches it through an SSH tunnel, as on AWS. A firewall in front of the server has to let that port through.
5. Opens a tunnel and your browser at http://localhost:4600. **The first page shows the office password once. Write it down.**

The agents and GitHub sign in as on AWS: `--claude-token`, `--anthropic-api-key`, `--github-token` or `--no-github-token`. `--server <name>` picks one of Coolify's servers when it has more than one.

```bash
deploy/coolify.sh open              # tunnel + open the office (Ctrl-C closes the tunnel)
deploy/coolify.sh status            # its page in Coolify, last deployment, SSH address, who's invited
deploy/coolify.sh invite octocat    # let a teammate tunnel in with their GitHub SSH keys
deploy/coolify.sh logs              # follow the office's logs (ssh: a shell in the container)
deploy/coolify.sh update            # build this checkout's HEAD (pushed) and redeploy it
deploy/coolify.sh destroy           # delete the application and its volume (asks first)
```

The details, what's on the volume, and troubleshooting are in [docs/coolify.md](docs/coolify.md).

## Deploy to any Ubuntu or Debian server

Another cloud, or your own machine? Run one line on the server, as root or as a user with sudo:

```bash
curl -fsSL https://raw.githubusercontent.com/sagardhande2942/agent-office-sd/main/deploy/provision.sh | bash
```

It installs Node 22, git, the GitHub CLI, Claude Code and the office as a systemd service. Run as root, it creates an `agentoffice` user to run the office, so workers never run as root. The office listens on `127.0.0.1:4600` only, and the script ends by printing the SSH tunnel command and a link that shows the office password once. Run the same line again to update.

For HTTPS on your own domain, point a DNS record at the server and add `bash -s -- --domain office.example.com`: it sets up Caddy, which gets the certificate by itself. To put it on your Tailscale network instead, add `bash -s -- --tailscale`. The details, and setting it up by hand behind Caddy or nginx, are in [docs/self-hosting.md](docs/self-hosting.md).

## Add users

Everyone gets their own account, so their name is on their character, in chat and on every terminal they type into.

**1. On a server, let them in first.** On a [Tailscale](docs/aws.md#tailscale) office, everyone on your tailnet can already open it. For someone who isn't, share the machine with them from Tailscale's Machines page: **☰ → 👥 Invite teammates** says how. Skip to step 2.

Otherwise the office is only reachable through an SSH tunnel, so a teammate needs their SSH key on the machine. In the office, open **☰ → 👥 Invite teammates** and type their GitHub username. On AWS, Railway, Fly.io, Dokploy or Coolify you can also do it from your terminal:

```bash
deploy/aws.sh invite octocat        # installs the keys from github.com/octocat.keys
deploy/aws.sh allow 203.0.113.7     # their IP ("allow anywhere" opens SSH to every IP)
deploy/railway.sh invite octocat    # on Railway, SSH answers every IP already
deploy/fly.sh invite octocat        # and on Fly.io
deploy/dokploy.sh invite octocat    # and on Dokploy
deploy/coolify.sh invite octocat    # and on Coolify
```

It prints the command to send them. They leave it running and open http://localhost:4600:

```
ssh -L 4600:localhost:4600 office@<your-office-ip>
```

(On Railway and Fly.io the address carries a port of its own, like `ssh://office@zephyr.proxy.rlwy.net:17738`. On Dokploy and Coolify it's the server's SSH port for the office: `ssh://office@203.0.113.7:2222`.)

Their key logs in as a locked-down `office` user that can only forward to the office port: no shell, no other ports. Running the office on your own computer, or on your own domain over HTTPS? Skip this step.

A teammate with the `agent-office` command on their computer can run `agent-office tunnel office@<your-office-ip>` instead of the `ssh` line: it opens the same tunnel, and every web server a worker starts opens on their computer too ([docs/tunnel.md](docs/tunnel.md)).

**2. Make them an account.** Open **☰ → 🔑 Accounts** and make an invite link. Name it (or let them pick) and make them a *Member* or an *Admin*. The link works once, for 7 days, and they choose their own password. Make one for yourself too, as an admin.

The same works from a terminal on the office's machine, even while it runs:

```bash
agent-office accounts                      # accounts and open invites
agent-office accounts invite ada --admin   # prints a single-use /join#… link
agent-office accounts role ada member
agent-office accounts revoke ada           # signed out within seconds
```

On the EC2 machine, run it through `deploy/aws.sh ssh` (on Azure, `deploy/azure.sh ssh`):

```bash
deploy/aws.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada --dir "$(cat /etc/agent-office/home)"'
deploy/railway.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada'   # on Railway
deploy/fly.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada'       # on Fly.io
deploy/dokploy.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada'   # on Dokploy
deploy/coolify.sh ssh 'node /opt/agent-office/bin/agent-office.js accounts invite ada'   # on Coolify
```

**Their own Claude and code host.** With accounts, everyone's workers run on their own Claude plan, and the office acts on their code host as them: comments, merges, pushes and pull requests show up under their name. The first time someone comes in, **🔐 Your sign-ins** opens (it's in the **☰** menu too). *Sign in with Claude* gives them Claude's sign-in page and takes back the code it shows. *Sign in with GitHub* shows a one-time code for github.com/login/device. Bitbucket has no such page to hand out, so that card takes a pasted Atlassian API token — type it as `myusername ATBB…`. They can paste a token from `claude setup-token` or a GitHub token instead too. A 🐚 shell they open at a desk runs as them, so `claude auth login`, `gh auth login` and `bb auth login` typed there work as well. Admins can use the office machine's own sign-ins instead. Each account's sign-ins live in `.agent-office/homes/<account>/`, and revoking the account deletes them. The sign-in that matters on a floor is the one for that floor's host, so someone signed in to GitHub is asked for their Bitbucket sign-in when they go to a Bitbucket floor. The boards are read with the machine's own CLI, so that account needs read access to the repos. Running it just for yourself, with no accounts, none of this applies.

**3. Turn off the shared password.** Until you do, anyone who knows the office password can get in, as an admin. Once everyone has an account, switch it off in **🔑 Accounts** (signed in with your own admin account), or `agent-office accounts password off`.

**Removing someone.** Revoke their account in **🔑 Accounts** (or `agent-office accounts revoke <name>`), and on a server also remove them in **👥 Invite teammates** (on AWS, `deploy/aws.sh uninvite <name>`; on Railway, `deploy/railway.sh uninvite <name>`; on Fly.io, `deploy/fly.sh uninvite <name>`; on Dokploy, `deploy/dokploy.sh uninvite <name>`; on Coolify, `deploy/coolify.sh uninvite <name>`) to take away their SSH keys and drop open tunnels (other teammates just reconnect). If the shared password is still on, change it with `deploy/aws.sh reset-password` (or `deploy/railway.sh reset-password`, `deploy/fly.sh reset-password`, `deploy/dokploy.sh reset-password` or `deploy/coolify.sh reset-password`).

## Additional office features

### Helpers

Helpers can assist agent and shell workers, in their own worktree or the shared project checkout. Shell workers receive the findings in office chat; reports are never typed into bash as commands.

Helpers display their current status and activity above their heads, including when their agent needs input or is offline. Open the helper’s terminal to inspect its actual output.

Helper findings appear both in the host worker’s inbox and in its terminal window. The worker can read and acknowledge the inbox report at a tool checkpoint during its current task; acknowledgment clears the manual delivery card. You can also choose **Interrupt and deliver report** (or **Deliver report** when idle). Successful terminal delivery completes the inbox report and clears the card, preventing duplicate delivery through the other path. If stopping fails, the report remains available. Handling a report does not confirm that its findings were fixed. Shell reports remain in office chat.

At a regular worker’s desk, press U or click **U — Bring a helper** to open the helper dialog. This works for shell and agent workers with or without a separate worktree.

Helpers carry a laptop showing their own terminal. Aim at the helper or its laptop and press **E**, or click **Open helper terminal** in the hint. You can also open the helper by name in the Workers list. **Needs you** means its agent is waiting: answer the question or approve/reject the permission request inside that helper’s terminal. Close it with Esc or ✕ to return to the office.

Sending a worker home also stops and removes its helper before cleaning up the worker’s checkout. Sending only the helper home leaves the host worker and its worktree intact.

### Planning and completion

Use **Compare plans** to seat up to five independent models and one reviewer at a separate table. Candidates submit detailed plans against the same requirements and fixed rubric. The reviewer explains acceptance and rejection, the server selects the highest-rated eligible plan, cleans up the rejected workers, and starts the winner in a fresh implementation conversation. Available in 3D, lite and the terminal dashboard; candidates and reviewers can use Claude Code, OpenCode 1.x, Codex, Grok, Muse Code, DeepSeek Harness, Pi, Cursor or Antigravity on local Git floors using the Office map. OpenCode planning uses its built-in Plan agent with the office read/plan-tool guard for Zen compatibility; provider-side free-model errors may still require another authorized model. Codex planning tools are preapproved for each role while its checkout stays read-only. See [plan comparison](docs/plan-comparison.md).

Use **Master / Workers** for one intelligent master and up to five workers selected from your eligible model pool. The master plans, delegates, contributes, reviews isolated worker branches, verifies integration and delivers one ready-for-review PR. Save and edit office-wide team presets, follow task results, or pause/resume the activity from Lite, the game menu or the terminal dashboard. Failed assignments get one retry with a different eligible model before master takeover. Use **Replay** on a current or retained activity to inspect its chronological events, filter by participant/task/type, and expand recorded evidence without running agents. Reported checks remain distinct from office-verified facts; missing history is explicit. See [Master / Workers](docs/master-workers.md).

Workers can record a **completion checklist** with actual check results, changed files and a PR link (or reasons they do not apply). Inspect it in worker terminals, lite cards, CLI worker details and finished queue tasks. Failed checks remain visible as needing attention; a ready terminal alone is not proof of success. See [completion checklists](docs/completion-checklist.md) for CLI/MCP submission and lifecycle.
See [the upstream integration notes](docs/upstream-integration.md) for the imported features and preserved fork behavior.

### Office tools and activities

Press **J** or choose **Smartphone** in the menu to find workers and helpers, open their terminals, send a prompt or review a helper report. Messages may queue while a worker is busy; replies and approvals are handled in the terminal. Phone history lasts for this browser session.

The garage uses Blender-built Lambo and Ferrari models with wheel arches, detailed wheels and roof-off cockpits. Drive them with the existing E/WASD controls. If the model asset fails to load, the original cars remain available. The build includes the models; Blender is only needed to regenerate them (see [Blender models](blender/README.md)).

Open **Boss Control Center** from the menu or the Workers panel’s **Boss** button, or sit in the boss chair and press E. It shows live worker status and reported spend, opens terminals/helper reports, reviews agent broadcast or auto-assign prompts, and exports a local floor report. Send-home uses the existing worktree choices. **Play Minesweeper** remains available. See [features](docs/features.md) and the [PR295 security review](docs/security/pr-295.md).

TV playback controls and theatre lighting update every viewer on the floor immediately, including hosted floors. External video playback still depends on the source allowing playback/embedding.

At side angles, TV video is masked by the whiteboard’s thin panel and stand rather than its wider walking envelope.

### Agent setup and remote terminals

OpenCode model selections use per-process configuration, including models set in the default worker or `--agent-args`; no `--model` flag is sent to its interactive CLI. OpenCode 2 workers start private servers so each receives its own settings. Leave Model on **Default** to retain your OpenCode settings. See [agents](docs/agents.md) for model and resume behavior.

Codex input alerts require a visible sign-in/trust prompt or a permission hook; missing startup hooks alone do not mean the worker needs you. Native Windows hook commands support cmd.exe and PowerShell with paths containing spaces; restart the office or floor host and existing Codex workers after updating. See [agent status tracking](docs/agents.md).

Antigravity CLI is selectable when hiring, configuring board agents and queue tasks, or choosing comparison candidates/reviewers. Install and sign in with `agy` on the office machine, then use `agent-office --agent agy` for the default. See [agent setup](docs/agents.md#antigravity-cli).

Remote worker terminals provide **Local typing** for responsive editing over slow floor-host connections. Draft locally, then press Enter to send or use Insert to paste without submitting. Update both office and floor host to remove per-key acknowledgements and room-state refresh traffic. See [remote terminal typing](docs/floor-hosts.md#typing-in-remote-terminals).

Admins can remove a remote floor with the trash button in **Elevator**, including when its machine is offline. It disappears for everyone immediately; the joiner's checkout stays on their machine. If an older office left a stale row after deletion, delete it again after updating.

**Bring your own project from another computer.** Open **☰ → Connect your floor**. The office host generates a pairing code; the joiner enters the office's public URL, that code, and their own project folder, then copies and runs the join command from their agent-office checkout. The command calls Node directly so PowerShell preserves all CLI flags. The floor appears in the elevator immediately: no host-side path entry, `hosts add-floor`, or office restart. The joiner needs an installed, built copy of this version (`npm install`, then `npm run build`) even if the office runs with `npm run dev`. With ngrok, forward **4600** and use its HTTPS URL. Everyone in the office can control the joiner's terminals, so connect only to a trusted office. See [floor-host setup](docs/floor-hosts.md#quick-connect-from-the-ui).

If reconnect says the repository already has a floor after your saved token was lost or replaced, stop the machine's floor host. The office admin opens **Connect your floor**, finds the original offline machine under **Paired machines**, and clicks **Reconnect this machine**. Enter the joiner's original checkout path and share the generated command with them. It includes `--recover` to replace the incorrect saved credential while preserving the original machine and floors. Future reconnects use `node bin/agent-office.js floor-host` without a code.

Remote floor reconnects retain the saved machine identity even when the original pairing command is reused. For a changed URL of the same office, use `--same-office`. Agent CLIs must be available on the joiner's PATH; restart the floor host after installing one. See [floor-host setup](docs/floor-hosts.md#quick-connect-from-the-ui).

### Playable 2D Game

Open **`/2d`** for the complete office in a desktop, top-down view. It uses the same artwork, rooms, furniture, characters, collisions and feature modules as 3D. **Tab** opens the same menu: boards, Queue, Plan Comparison, Boss Control Center, Smartphone, meetings, messages, services, whiteboard, settings and the other office actions.

Walk with **WASD / arrows**, click the floor to walk there, click a worker to open its existing terminal, and use **E** beside a fixture. Scroll to zoom; the Manager uses its existing kiosk. The physical **elevator** and its menu provide all floors, project management, the rooftop bar and the garage. Castle, Station and custom maps work too. Golf, cars, arcade and the other activities keep their existing controls and aiming cameras, returning to the flat office view when finished.

The **View** selector switches 3D, 2D Game and Lite in the same tab while retaining the floor and running workers. Close dialogs with **✕** or **Esc** to resume controls immediately. 2D Game uses WebGL like 3D; **Lite** remains the lightweight, phone-friendly option. See [controls](docs/controls.md#2d-game-desktop), [architecture](docs/code-layout.md#playable-2d-client), and [screenshots and verification](docs/game2d-verification.md).

Press **Y** or use the top-bar **2D / 3D** toggle to switch views instantly in the same scene, without a page reload or reconnect. Your position, selected floor, workers and session stay intact; returning to 3D restores your previous view and facing. The shortcut is inactive while typing or a dialog is open. Finish camera-controlled activities before switching; Lite still opens a separate page. In 2D, jumping moves your character while the camera and cutaway stay anchored to the supporting floor.

In **2D Game**, open **Tab → 2D graphics settings** to choose **Reduced (current)** or **Enhanced**. Reduced is the default and preserves the existing quality. Enhanced increases rendering resolution (2–3× pixel ratio) and enables real-time shadows. Changes apply immediately, persist in this browser, and affect only 2D exploration; activities retain their original rendering. Choose Reduced on slower hardware.

### Worker appearances

Models in the office, character previews and model lab render without the blue-grey cartoon outlines. See [rendering](docs/features.md#model-rendering).
First-person hands render over the office without clearing it, so switching from 2D to 3D keeps the world visible.

Admins can choose Original and/or 20 code-built fictional characters in **Settings → Workers**. Select a roster and apply it immediately across all floors. Fictional characters never duplicate; extra workers use Original, and assignments survive restart. Each includes its signature outfit. See [worker appearances](docs/worker-appearances.md).

## Office interiors

Keep the original warm office or switch to the futuristic graphite-and-blue design from
**Settings → Building → Theme**. Choose **Original office** for the wood floors,
colorful chairs and pendant lamps, or **Futuristic office** for dark furniture, tiled finishes,
linear blue lighting and acoustic panels. Switching is live, keeps workers and terminals in
place, and is saved for everyone in the building. Calendar and holiday themes use the original
interior with their seasonal decorations.

For an interactive preview without signing in, run `npm run dev` and open
`http://localhost:5173/lab/office.html`. Its buttons switch between both interiors; add
`?view=meeting` for the glass-room view or `?interior=original` to start in the original office.
Drag to orbit and scroll to zoom. See [Maps](docs/maps.md#office-interiors) for the implementation.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Walk (hold Shift to run) |
| Space | Jump |
| Mouse drag / wheel | Orbit / zoom the camera |
| E | Interact: hire a worker, open its terminal, read a board, sit down, ride the elevator |
| P | Give a task to a new worker, or to the one at this desk |
| C | See a worker's changes: diff, commit, open a PR |
| N | Go to the next worker that's waiting on you |
| X | Send a worker home |
| Z | Send a finished worker on a break, or back to its desk |
| L | Hang a sign over a desk ("Operations", "Code cleanup") |
| T / Enter | Chat |
| V | Join voice; then hold V to talk |
| M | Mute / unmute in voice |
| Ctrl + Space | Dictate into a terminal or a prompt box: hold it and talk (or hold the **🎤**) |
| Tab | The ☰ menu: every window |
| Esc | Close any window |
| Ctrl + [ | Send Esc to a terminal, to close a menu like Claude's `/skills` or interrupt Claude (or **⎋ Esc** in its header) |

The full list is in [docs/controls.md](docs/controls.md).

## Development

PRs and deployment defaults target **`sagardhande2942/agent-office-sd`**. With push access, push a feature branch directly and create a PR with `gh pr create --repo sagardhande2942/agent-office-sd --base main`. Without push access, fork this repository, push your branch to your fork, and create the PR with `gh pr create --repo sagardhande2942/agent-office-sd --base main --head <your-github-user>:<branch>`. Release installers download this repository’s published release artifacts; if no release is available, use the source installation instructions above.

```bash
npm install
npm run dev          # Vite with hot reload on :5173, the server on :4600 (password: 123)
npm run typecheck
npm test
npm run build && npm run e2e:live-view-toggle   # browser check of the live 2D/3D Y toggle
```

Server edits restart the server, not the workers. After changing `ptyhost.ts`, bump `PTY_PROTOCOL` in `ptys.ts` so the next server replaces the PTY host.

[docs/code-layout.md](docs/code-layout.md) says where the code lives, and where a new feature's pieces go.

The rules for coding agents working on this repository are in [`AGENTS.md`](AGENTS.md), which Codex, OpenCode and most other agent CLIs read. `CLAUDE.md` only imports it for Claude Code, so new rules go in `AGENTS.md`.

Every change to the app that lands on `main` is published as a GitHub release by [`.github/workflows/release.yml`](.github/workflows/release.yml), and `install.sh` installs the newest one. Bump `package.json`'s version to start a new minor.

## More

- [Features](docs/features.md): everything in the office, room by room
- [Agents](docs/agents.md): Claude Code, Codex and OpenCode, models and effort, and the office's prompts
- [Floor hosts](docs/floor-hosts.md): running a floor or repo-less demo on someone else's machine, live terminal and room updates, and reconnecting after a disconnect
- [Configuration](docs/configuration.md): every command-line option, and where the office keeps its data
- [Maps](docs/maps.md): the castle, the space station, and making a map of your own
- [Workers' servers on your own computer](docs/tunnel.md): `agent-office tunnel`, which opens every worker's web server on your computer by itself
- [AWS reference](docs/aws.md): Tailscale, service tunnels, upgrades, and everything `deploy/aws.sh` does
- [Railway reference](docs/railway.md): what `deploy/railway.sh` sets up, and what the volume keeps
- [Fly.io reference](docs/fly.md): what `deploy/fly.sh` sets up, machine sizes, pausing and what the volume keeps
- [Dokploy reference](docs/dokploy.md): what `deploy/dokploy.sh` sets up on your Dokploy, and what the volume keeps
- [Coolify reference](docs/coolify.md): what `deploy/coolify.sh` sets up on your Coolify, building pushed commits, and what the volume keeps
- [Your own server](docs/self-hosting.md): the one-line setup for any Ubuntu or Debian server, or by hand behind Caddy or nginx
- [Azure reference](docs/azure.md): picking a VM size, pausing, and everything `deploy/azure.sh` does
- [How it works](docs/how-it-works.md): the architecture, and security notes
- [Code layout](docs/code-layout.md): where the code lives, adding a feature or an agent provider, and the size guard

- [Decisions](docs/decisions/further-enhancements.md): what the table of bots decided to build next, and why
- [Streaming to the TV](docs/tv-streaming.md): what plays on the lounge TV, and how every browser stays in step with it

## License

[MIT](LICENSE)
