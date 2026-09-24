import { describe, expect, test } from "bun:test"
import path from "path"
import { EnvFile } from "../../src/util/env-file"
import { tmpdir } from "../fixture/fixture"

const KEYS = [
  "OPENCODE_ENV_FILE_FROM_FILE",
  "OPENCODE_ENV_FILE_EXISTING",
  "OPENCODE_ENV_FILE_EXPORTED",
  "OPENCODE_ENV_FILE_QUOTED",
  "OPENCODE_ENV_FILE_SINGLE",
  "OPENCODE_ENV_FILE_MALFORMED",
]

describe("util.env-file", () => {
  test("loads assignments without overriding the process environment", async () => {
    await using tmp = await tmpdir()
    const file = path.join(tmp.path, ".env")
    await Bun.write(
      file,
      [
        "# comment",
        "",
        "OPENCODE_ENV_FILE_FROM_FILE=from-file",
        "OPENCODE_ENV_FILE_EXISTING=from-file",
        "export OPENCODE_ENV_FILE_EXPORTED=exported",
        'OPENCODE_ENV_FILE_QUOTED="value with spaces"',
        "OPENCODE_ENV_FILE_SINGLE='single quoted'",
        "OPENCODE_ENV_FILE_MALFORMED",
      ].join("\n"),
    )

    for (const key of KEYS) delete process.env[key]
    process.env.OPENCODE_ENV_FILE_EXISTING = "from-process"

    try {
      EnvFile.loadEnvFile(file)

      expect(process.env.OPENCODE_ENV_FILE_FROM_FILE).toBe("from-file")
      expect(process.env.OPENCODE_ENV_FILE_EXISTING).toBe("from-process")
      expect(process.env.OPENCODE_ENV_FILE_EXPORTED).toBe("exported")
      expect(process.env.OPENCODE_ENV_FILE_QUOTED).toBe("value with spaces")
      expect(process.env.OPENCODE_ENV_FILE_SINGLE).toBe("single quoted")
      expect(process.env.OPENCODE_ENV_FILE_MALFORMED).toBeUndefined()
    } finally {
      for (const key of KEYS) delete process.env[key]
    }
  })

  test("is a no-op when the file is missing", async () => {
    await using tmp = await tmpdir()
    expect(() => EnvFile.loadEnvFile(path.join(tmp.path, "missing.env"))).not.toThrow()
  })
})
