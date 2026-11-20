import { Effect } from "effect"
import type { DatabaseMigration } from "../migration.js"

// global 是多个没有独立仓库根的目录共用的占位项目，V1 导入把它的 worktree 写成了文件系统根。
// 根不是任何会话的目录，还会让路径包含判断把整个磁盘都算作 global；用该项目登记过的真实目录替换，
// 这样老库在下次启动时就有真实位置。没有登记目录时保持原值，等解析到真实目录时由 Project.persist 修复。
const migration: DatabaseMigration.Migration = {
  id: "20261120120000_repair_global_project_root",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        UPDATE \`project\`
        SET \`worktree\` = (
          SELECT \`directory\` FROM \`worktree\`
          WHERE \`project_id\` = \`project\`.\`id\`
          ORDER BY \`time_created\` DESC
          LIMIT 1
        )
        WHERE \`id\` = 'global'
          AND (
            \`worktree\` = ''
            OR \`worktree\` = '/'
            OR \`worktree\` GLOB '[A-Za-z]:/'
          )
          AND EXISTS (SELECT 1 FROM \`worktree\` WHERE \`project_id\` = \`project\`.\`id\`)
      `)
    })
  },
}

export default migration
