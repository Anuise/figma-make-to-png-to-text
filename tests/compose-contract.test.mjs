import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import test from "node:test";

test("Compose declares the persistent local analysis services", () => {
  const output = execFileSync(
    "docker",
    ["compose", "config", "--format", "json"],
    { encoding: "utf8" },
  );
  const config = JSON.parse(output);

  assert.deepEqual(Object.keys(config.services).sort(), [
    "postgres",
    "web",
    "worker",
  ]);
  assert.match(config.services.postgres.image, /^postgres:16/);

  for (const serviceName of ["web", "worker"]) {
    const sourceMount = config.services[serviceName].volumes.find(
      (volume) => volume.target === "/sources",
    );
    assert.equal(sourceMount.type, "bind");
    assert.equal(sourceMount.read_only, true);
  }

  assert.ok(
    config.services.postgres.volumes.some(
      (volume) => volume.target === "/var/lib/postgresql/data",
    ),
  );
  assert.ok(
    config.services.worker.volumes.some(
      (volume) => volume.target === "/data",
    ),
  );
});
