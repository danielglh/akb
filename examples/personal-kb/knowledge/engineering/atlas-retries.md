---
type: Playbook
title: Atlas API 重试策略
description: Synthetic Atlas retry policy for evaluating AKB; not a real service policy.
tags: [atlas, api, retry]
status: stable
sources:
  - id: policy-v1
    resource: ../../source/atlas-policy.txt
    title: Synthetic Atlas policy v1
---
# Atlas API 重试策略

## Scope

This is fictional evaluation material, not operational guidance for a real API.

## Policy

Atlas API v1 transient failures may be retried at most three times.[^policy-v1]
Use exponential backoff. Authentication errors must not be retried.[^policy-v1]

[^policy-v1]: Synthetic Atlas policy v1.
