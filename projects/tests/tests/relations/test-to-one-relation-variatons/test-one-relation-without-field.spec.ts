import {
  Entity,
  Fields,
  InMemoryDataProvider,
  Remult,
  getEntityRef,
} from '../../../../core'
import { describe, it, expect, beforeEach } from 'vitest'
import type { ClassType } from '../../../../core/classType'

@Entity('categories')
class Category {
  @Fields.integer()
  id = 0
  @Fields.string()
  name = ''
}
@Entity('task')
class Task {
  @Fields.integer()
  id = 0
  @Fields.string()
  title = ''
  @Fields.reference<Task, Category>(() => Category)
  category?: Category
}

describe('test one', () => {
  let remult: Remult
  let cat1: Category
  let cat2: Category
  let cat3: Category
  function repo<T>(x: ClassType<T>) {
    return remult.repo(x)
  }
  beforeEach(async () => {
    remult = new Remult(new InMemoryDataProvider())
    ;[cat1, cat2, cat3] = await repo(Category).insert(
      [1, 2, 3].map((y) => ({ id: y, name: 'cat' + y })),
    )
    await repo(Task).insert({ id: 1, title: 'task1', category: cat1 })
  })
  it('test insert', async () => {
    await repo(Task).insert({ id: 2, category: cat2 })

    await repo(Task)
      .findFirst(
        { id: 2 },
        {
          include: {
            category: true,
          },
        },
      )
      .then((t) => {
        expect(t.category?.name).toBe('cat2')
      })
    expect(
      (
        await repo(Task).find({
          where: {
            category: cat2,
          },
        })
      ).map((y) => y.id),
    ).toEqual([2])
  })
  it('test update', async () => {
    let t = await repo(Task).findFirst()
    t.category = cat2
    expect((await getEntityRef(t).save()).category.id).toBe(2)
    await repo(Task)
      .findFirst(
        { id: 1 },
        {
          include: {
            category: true,
          },
        },
      )
      .then((t) => {
        expect(t.category?.name).toBe('cat2')
      })
  })
  it('test repo update', async () => {
    let t = await repo(Task).findFirst()
    expect((await repo(Task).update(1, { category: cat2 })).category.id).toBe(2)
    await repo(Task)
      .findFirst(
        { id: 1 },
        {
          include: {
            category: true,
          },
        },
      )
      .then((t) => {
        expect(t.category.id).toBe(2)
        expect(t.category?.name).toBe('cat2')
      })
  })
  it('test repo save', async () => {
    let t = await repo(Task).findFirst()
    expect((await repo(Task).save({ ...t, category: cat2 })).category.id).toBe(
      2,
    )
    await repo(Task)
      .findFirst(
        { id: 1 },
        {
          include: {
            category: true,
          },
        },
      )
      .then((t) => {
        expect(t.category.id).toBe(2)
        expect(t.category?.name).toBe('cat2')
      })
  })
  it('test repo update b', async () => {
    let t = await repo(Task).findFirst()
    await repo(Task).update(1, { title: 'tt' })
    await repo(Task)
      .findFirst(
        { id: 1 },
        {
          include: {
            category: true,
          },
        },
      )
      .then((t) => {
        expect(t.category.id).toBe(1)
        expect(t.category?.name).toBe('cat1')
      })
  })
  it('test repo save b', async () => {
    let t = await repo(Task).findFirst()
    debugger
    await repo(Task).save({ ...t, title: 'tt' })
    await repo(Task)
      .findFirst(
        { id: 1 },
        {
          include: {
            category: true,
          },
        },
      )
      .then((t) => {
        expect(t.category.id).toBe(1)
        expect(t.category?.name).toBe('cat1')
      })
  })
  it('test repo update c', async () => {
    let t = await repo(Task).findFirst()
    t.category = cat2
    expect((await repo(Task).update(1, { category: cat2 })).category.id).toBe(2)
    await repo(Task)
      .findFirst(
        { id: 1 },
        {
          include: {
            category: true,
          },
        },
      )
      .then((t) => {
        expect(t.category.id).toBe(2)
        expect(t.category?.name).toBe('cat2')
      })
  })
  it('test repo save c', async () => {
    let t = await repo(Task).findFirst()
    t.category = cat2
    expect((await repo(Task).save({ ...t, category: cat2 })).category.id).toBe(
      2,
    )
    await repo(Task)
      .findFirst(
        { id: 1 },
        {
          include: {
            category: true,
          },
        },
      )
      .then((t) => {
        expect(t.category.id).toBe(2)
        expect(t.category?.name).toBe('cat2')
      })
  })
  it('test filter', async () => {
    remult.dataProvider = new InMemoryDataProvider()
    for (const cat of [cat1, cat2, cat3]) {
      for (let index = 0; index < cat.id; index++) {
        await repo(Task).insert({
          category: cat,
          id: cat.id * 100 + index + 1,
          title: 'cat ' + cat.id + ' task ' + (index + 1),
        })
      }
    }
    const r = repo(Task)
    expect(await r.count()).toBe(6)
    expect(await r.count({ category: cat2 })).toBe(2)
    expect(await r.count({ category: [cat1, cat3] })).toBe(4)
    expect(await r.count({ category: { '!=': cat1 } })).toBe(5)
    expect(await r.count({ category: { '!=': [cat1, cat3] } })).toBe(2)
  })
  it
})
