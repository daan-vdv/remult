import { it, expect, describe, beforeEach } from 'vitest'
import { DbTestProps } from './db-tests-props'
import { createEntity as createEntityClass } from '../../tests/dynamic-classes'
import {
  Entity,
  Fields,
  SqlDatabase,
  dbNamesOf,
  remult,
  type Remult,
} from '../../../core'
import { entityWithValidations } from './entityWithValidations.js'
import { cast, isOfType } from '../../../core/src/isOfType.js'
import { SqlCommandFactory } from '../../../core/src/sql-command.js'
import { migrate } from '../../../core/migrations/index.js'
import {
  compareMigrationSnapshot,
  emptySnapshot,
} from '../../../core/migrations/compare-migration-snapshots.js'
import {
  CanBuildMigrations,
  type Migrations,
} from '../../../core/migrations/migration-types.js'

export function SqlDbTests({
  createEntity,
  getRemult,
  getDb,
  skipMigrations,
  doesNotSupportDdlTransactions,
}: DbTestProps & {
  skipMigrations?: boolean
  doesNotSupportDdlTransactions?: boolean
}) {
  it('test dbReadonly ', async () => {
    const e = await createEntity(
      createEntityClass('x', {
        id: Fields.number(),
        a: Fields.number(),
        b: Fields.number({ dbReadOnly: true }),
        c: Fields.number({ sqlExpression: () => 'a+5' }),
      }),
    )
    const result = await e.insert({ id: 1, a: 1, b: 2 })
    expect(result).toMatchInlineSnapshot(`
      x {
        "a": 1,
        "b": 0,
        "c": 6,
        "id": 1,
      }
    `)
  })

  it('test wrap identifier', async () => {
    const dp = remult.dataProvider
    try {
      remult.dataProvider = getDb()
      @Entity('x_aTb')
      class c {
        @Fields.number()
        id = 0
        @Fields.number()
        aTb = 0
        @Fields.number({
          sqlExpression: async (x) => {
            let db = await dbNamesOf(c)
            return `${db.aTb}+2`
          },
        })
        c = 0
      }
      const e = await createEntity(c)
      const result = await e.insert({ id: 2, aTb: 1 })
      expect(result).toMatchInlineSnapshot(`
        c {
          "aTb": 1,
          "c": 3,
          "id": 2,
        }
      `)
    } finally {
      remult.dataProvider = dp
    }
  })
  it('test sql command factory', async () => {
    const repo = await entityWithValidations.create4RowsInDp(createEntity)
    const remult = getRemult()

    let f = SqlDatabase.getDb(remult.dataProvider)
    const e = await dbNamesOf(repo, f.wrapIdentifier)

    expect(
      (
        await f.execute(
          `select ${e.myId}, ${e.name} from ${e.$entityName} where ${e.myId} in (1,2)`,
        )
      ).rows.map((x) => ({ ...x })),
    ).toMatchInlineSnapshot(`
      [
        {
          "myId": 1,
          "name": "noam",
        },
        {
          "myId": 2,
          "name": "yael",
        },
      ]
    `)
  })
  it('test sql command factory with params', async () => {
    const repo = await entityWithValidations.create4RowsInDp(createEntity)
    const remult = getRemult()

    let f = SqlDatabase.getDb(remult.dataProvider)
    const e = await dbNamesOf(repo, f.wrapIdentifier)
    const c = f.createCommand()
    const result = await c.execute(
      `select ${e.myId}, ${e.name} from ${e.$entityName} where ${e.myId
      } in (${c.param(1)},${c.param(2)})`,
    )

    expect(result.rows.map((x) => ({ ...x }))).toMatchInlineSnapshot(`
      [
        {
          "myId": 1,
          "name": "noam",
        },
        {
          "myId": 2,
          "name": "yael",
        },
      ]
    `)
    expect([0, 1].map((x) => result.getColumnKeyInResultForIndexInSelect(x)))
      .toMatchInlineSnapshot(`
      [
        "myId",
        "name",
      ]
    `)
  })
  describe.skipIf(skipMigrations)('test migrations', () => {
    const migrationsTable = 'remult_migrations'
    let db: SqlCommandFactory
    let remult: Remult
    @Entity('tasks')
    class Task {
      @Fields.number()
      id = ''
      @Fields.string()
      title = ''
    }
    @Entity('tasks')
    class TaskEnhanced extends Task {
      @Fields.boolean()
      completed = false
      @Fields.date()
      createdAt = new Date()
    }
    beforeEach(async () => {
      db = cast<SqlCommandFactory>(getDb(), 'createCommand')
      remult = getRemult()
      for (const iterator of [
        migrationsTable,
        remult.repo(Task).metadata.dbName,
      ]) {
        try {
          await db.execute('drop table  ' + db.wrapIdentifier(iterator))
        } catch { }
      }
    })
    it('test migrations', async () => {
      await expect(() => remult.repo(Task).find()).rejects.toThrow()
      let migrations: Migrations = {}
      let snapshot = emptySnapshot()
      let migrationBuilder = cast<CanBuildMigrations>(
        getDb(),
        'provideMigrationBuilder',
      ).provideMigrationBuilder({
        addSql: (s) =>
        (migrations[Object.keys(migrations).length] = async ({ sql }) =>
          await sql(s)),
        addComment: () => {
          throw Error('not implemented')
        },
        addTypescriptCode: () => {
          throw Error('not implemented')
        },
      })
      snapshot = await compareMigrationSnapshot({
        entities: [Task],
        snapshot: snapshot,
        migrationBuilder,
      })
      expect(Object.keys(migrations).length).toBe(1)
      await migrate({
        migrations,
        dataProvider: getDb(),
        migrationsTable,
        endConnection: false,
      })
      expect(await remult.repo(Task).find()).toMatchInlineSnapshot('[]')
      await expect(() => remult.repo(TaskEnhanced).find()).rejects.toThrow()
      snapshot = await compareMigrationSnapshot({
        entities: [TaskEnhanced],
        snapshot: snapshot,
        migrationBuilder,
      })
      expect(Object.keys(migrations).length).toBe(3)
      await migrate({
        migrations,
        dataProvider: getDb(),
        migrationsTable,
        endConnection: false,
      })
      expect(await remult.repo(TaskEnhanced).find()).toMatchInlineSnapshot('[]')
    })
    it('test migrations transactions', async () => {
      const repo = await entityWithValidations.create4RowsInDp(createEntity)
      expect(await repo.count()).toBe(4)
      const n = await dbNamesOf(
        repo.metadata,
        cast<SqlCommandFactory>(getDb(), 'wrapIdentifier'),
      )
      await expect(
        async () =>
          await migrate({
            migrations: {
              0: async ({ sql }) => {
                await sql(`delete from ${n.$entityName} where ${n.myId} = 1`)
              },
              1: async ({ sql }) => {
                await sql(`delete from ${n.$entityName} where ${n.myId} = 2`)
                throw 'error'
              },
            },
            dataProvider: getDb(),
            migrationsTable,
          }),
      ).rejects.toThrow('error')

      expect(await repo.count()).toBe(3)
    })
    it.skipIf(doesNotSupportDdlTransactions)(
      'test migrations transactions and ddl',
      async () => {
        const tableName = 'xyz'
        await expect(
          async () =>
            await migrate({
              migrations: {
                0: async ({ sql }) => {
                  try {
                    await sql(`drop table ${tableName}`)
                  } catch { }
                },
                1: async ({ sql }) => {
                  await sql(`create table ${tableName}(id int)`)
                },
                2: async ({ sql }) => {
                  await sql('insert into ' + tableName + ' values (1)')
                  await sql(`alter table ${tableName} add  x int`)
                  throw 'error'
                },
              },
              dataProvider: getDb(),
              migrationsTable,
              endConnection: false,
            }),
        ).rejects.toThrow('error')
        const db = cast<SqlCommandFactory>(getDb(), 'createCommand')
        await expect(() =>
          db.execute(`select id,x from ${tableName}`),
        ).rejects.toThrow()
        expect(
          (await db.execute(`select id from ${tableName}`)).rows,
        ).toMatchInlineSnapshot('[]')
      },
    )
  })
}
