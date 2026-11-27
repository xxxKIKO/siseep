import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  type AuditEntity,
  FIELD_SHORT_NAMES,
  type FieldKey,
  NOTE_KIND_LABELS,
  type NoteKind,
  PERIOD_GROUP_STATUS_LABELS,
  type PeriodStatus,
  shortStudentName,
} from '@siseep/shared';
import type { Model, Types } from 'mongoose';
import { Activity } from '../activities/activity.schema';
import { Group } from '../groups/group.schema';
import { StudentNote } from '../notes/student-note.schema';
import { PeriodResult } from '../period-results/period-result.schema';
import { Student } from '../students/student.schema';

export interface DescribableEntry {
  action: 'create' | 'update' | 'delete';
  entity: AuditEntity;
  entityId: Types.ObjectId;
  groupId?: Types.ObjectId | null;
  before: unknown;
  after: unknown;
}

type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj =>
  value && typeof value === 'object' ? (value as Obj) : ({} as Obj);
const str = (value: unknown) => (typeof value === 'string' ? value : '');

const COMPONENT_LABELS: Record<string, string> = {
  DESEMPENO: 'Desempeño',
  PROYECTO: 'Proyecto',
  EXAMEN: 'Examen',
  COMPLEMENTARIA: 'Materia complementaria',
};

/** "8", "8.5", "NE", "Justificada", "—". */
function gradeText(value: unknown): string {
  const g = obj(value);
  if (!value) return '—';
  if (g.status === 'NOT_DELIVERED') return 'NE';
  if (g.status === 'EXCUSED') return 'Justificada';
  return typeof g.score === 'number' ? String(g.score) : '—';
}

const ACTIVITY_KEYS: Record<string, string> = {
  name: 'nombre',
  date: 'fecha',
  fieldKey: 'campo',
  component: 'componente',
  medium: 'medio',
  description: 'descripción',
  visibleToGuardians: 'visible para padres',
};

function plain(key: string, value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'sí' : 'no';
  if (key === 'fieldKey') return FIELD_SHORT_NAMES[value as FieldKey] ?? String(value);
  if (key === 'component') return COMPONENT_LABELS[String(value)] ?? String(value);
  return typeof value === 'string' ? `'${value}'` : JSON.stringify(value);
}

/** Changed keys as "nombre 'A' → 'B', fecha 2026-11-02 → 2026-11-03". */
function diff(before: Obj, after: Obj, labels: Record<string, string>): string {
  return Object.keys(labels)
    .filter((key) => JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null))
    .map((key) => `${labels[key]} ${plain(key, before[key])} → ${plain(key, after[key])}`)
    .join(', ');
}

/**
 * Turns audit entries into one readable line (section 7: "¿quién cambió este 6 a 8?"). Names are
 * looked up in batch: students, activities, notes, period results and groups.
 */
@Injectable()
export class AuditDescriber {
  constructor(
    @InjectModel(Student.name) private readonly studentModel: Model<Student>,
    @InjectModel(Activity.name) private readonly activityModel: Model<Activity>,
    @InjectModel(StudentNote.name) private readonly noteModel: Model<StudentNote>,
    @InjectModel(PeriodResult.name) private readonly resultModel: Model<PeriodResult>,
    @InjectModel(Group.name) private readonly groupModel: Model<Group>,
  ) {}

  async describe(
    entries: DescribableEntry[],
  ): Promise<{ descriptions: string[]; groupNames: Map<string, string> }> {
    const ids = (entity: AuditEntity) =>
      entries.filter((e) => e.entity === entity).map((e) => e.entityId);
    const [notes, results, groups] = await Promise.all([
      this.noteModel
        .find({ _id: { $in: ids('note') } }, { studentId: 1 })
        .lean()
        .exec(),
      this.resultModel
        .find({ _id: { $in: ids('periodResult') } }, { studentId: 1 })
        .lean()
        .exec(),
      this.groupModel
        .find({ _id: { $in: entries.flatMap((e) => (e.groupId ? [e.groupId] : [])) } }, { name: 1 })
        .lean()
        .exec(),
    ]);
    const noteStudent = new Map(notes.map((n) => [n._id.toString(), n.studentId.toString()]));
    const resultStudent = new Map(results.map((r) => [r._id.toString(), r.studentId.toString()]));

    const studentIds = new Set<string>();
    const activityIds = new Set<string>();
    for (const e of entries) {
      const data = { ...obj(e.before), ...obj(e.after) };
      if (str(data.studentId)) studentIds.add(str(data.studentId));
      if (str(data.activityId)) activityIds.add(str(data.activityId));
      if (e.entity === 'activity') activityIds.add(e.entityId.toString());
    }
    for (const id of [...noteStudent.values(), ...resultStudent.values()]) studentIds.add(id);
    const [students, activities] = await Promise.all([
      this.studentModel
        .find({ _id: { $in: [...studentIds] } }, { firstName: 1, lastName1: 1 })
        .lean()
        .exec(),
      this.activityModel
        .find({ _id: { $in: [...activityIds] } }, { name: 1 })
        .lean()
        .exec(),
    ]);
    const studentName = new Map(students.map((s) => [s._id.toString(), shortStudentName(s)]));
    const activityName = new Map(activities.map((a) => [a._id.toString(), a.name]));
    const groupNames = new Map(groups.map((g) => [g._id.toString(), g.name]));
    const who = (id: string | undefined) => (id && studentName.get(id)) || 'un alumno';

    const descriptions = entries.map((e) => {
      const before = obj(e.before);
      const after = obj(e.after);
      const data = { ...before, ...after };
      switch (e.entity) {
        case 'grade': {
          const activity = activityName.get(str(data.activityId)) ?? 'una actividad';
          const prefix = `Calificación de ${who(str(data.studentId))} en '${activity}'`;
          return e.action === 'create'
            ? `${prefix}: ${gradeText(e.after)}`
            : `${prefix}: ${gradeText(e.before)} → ${gradeText(e.after)}`;
        }
        case 'activity': {
          const name =
            str(after.name) || str(before.name) || activityName.get(e.entityId.toString());
          if (e.action === 'create') {
            return `Creó la actividad '${name}' (${plain('fieldKey', after.fieldKey)} · ${plain('component', after.component)})`;
          }
          if (e.action === 'delete') return `Borró la actividad '${name}'`;
          const changes = diff(before, after, ACTIVITY_KEYS);
          return `Actividad '${name}'${changes ? `: ${changes}` : ': sin cambios visibles'}`;
        }
        case 'note': {
          const kind = NOTE_KIND_LABELS[(str(data.kind) || 'OTRO') as NoteKind];
          const verb =
            e.action === 'create' ? 'creada' : e.action === 'delete' ? 'borrada' : 'editada';
          return `Nota de ${who(noteStudent.get(e.entityId.toString()))} (${kind}): ${verb}`;
        }
        case 'periodResult': {
          const name = who(resultStudent.get(e.entityId.toString()));
          const parts: string[] = [];
          const fieldsOf = (o: Obj) =>
            new Map(
              (Array.isArray(o.fields) ? (o.fields as Obj[]) : []).map((f) => [
                str(f.fieldKey),
                f.override ?? null,
              ]),
            );
          const b = fieldsOf(before);
          const a = fieldsOf(after);
          for (const key of new Set([...b.keys(), ...a.keys()])) {
            const from = b.get(key) ?? null;
            const to = a.get(key) ?? null;
            if (from !== to) {
              parts.push(
                `ajuste de ${FIELD_SHORT_NAMES[key as FieldKey] ?? key} ${from ?? '—'} → ${to ?? '—'}`,
              );
            }
          }
          if (JSON.stringify(before.observations) !== JSON.stringify(after.observations)) {
            parts.push('observaciones');
          }
          if ((before.legendOverride ?? null) !== (after.legendOverride ?? null)) {
            parts.push('leyenda');
          }
          return `Resultados de ${name}: ${parts.length ? parts.join(', ') : 'sin cambios'}`;
        }
        case 'periodStatus': {
          const label = (s: unknown) =>
            PERIOD_GROUP_STATUS_LABELS[s as PeriodStatus] ?? String(s ?? '—');
          const group = e.groupId ? (groupNames.get(e.groupId.toString()) ?? '') : '';
          const reason = str(after.reason);
          return `Periodo${group ? ` de ${group}` : ''}: ${label(before.status)} → ${label(after.status)}${reason ? ` (motivo: ${reason})` : ''}`;
        }
        case 'guardianLink': {
          const guardian = str(data.guardianName) || 'un tutor';
          const relationship = str(data.relationship);
          const student = who(str(data.studentId));
          return e.action === 'delete'
            ? `Desvinculó a ${guardian}${relationship ? ` (${relationship})` : ''} de ${student}`
            : `Vinculó a ${guardian}${relationship ? ` (${relationship})` : ''} con ${student}`;
        }
        default:
          return `${e.action} ${e.entity}`;
      }
    });
    return { descriptions, groupNames };
  }
}
