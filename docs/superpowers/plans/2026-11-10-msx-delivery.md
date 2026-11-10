# MSX Delivery Implementation Plan

**Goal:** Deliver the existing WEB build to MSX from the Pi Home server.
**Architecture:** Generate a launcher after Host validation; serve the existing build and package both in a multi-stage image.
**Tech Stack:** Node 24, Docker Compose, node:test.
**Spec:** `docs/superpowers/specs/2026-11-10-msx-delivery.md`

- [x] Write HTTP tests for launcher fields, HEAD, host rejection, CORS isolation, missing build and local assets; run and observe failure.
- [x] Implement launcher and stale-path handling; run HTTP tests and server suite.
- [x] Add image, Compose and Pi/MSX migration instructions; build WEB and validate Compose where Docker is available.
- [x] Smoke-test the built app in a browser and report remaining TV/ARM64 limits.

## Execution notes

Server tests 57/57, build helper tests 10/10, WEB build and checker passed. Offline Chromium loaded local JS/CSS. Docker image build and runtime checks passed on the executor, including restart persistence of config and secret reference; Compose configuration validated. Physical TV and Pi ARM64 remain untested. Root Vitest has two existing failures: torrent preload implementation lookup and episode menu `window` reference.
