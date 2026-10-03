import { test } from "node:test";
import assert from "node:assert/strict";
import { isPrivateHost } from "../src/lib/proxy-guard";

test("private and metadata hosts are detected", () => {
  for (const h of ["localhost", "127.0.0.1", "10.1.2.3", "192.168.1.218", "172.16.0.1", "172.31.255.255", "169.254.169.254", "metadata.google.internal", "[::1]", "fd00::1", "printer.local"]) {
    assert.equal(isPrivateHost(h), true, h);
  }
});

test("public hosts pass", () => {
  for (const h of ["launch.smarthealthit.org", "demo.orthanc-server.com", "fhir.epic.com", "172.32.0.1", "8.8.8.8", "hapi.fhir.org"]) {
    assert.equal(isPrivateHost(h), false, h);
  }
});
