import { randomUUID } from "node:crypto";

// Reserve on dispatch, settle on completion, release on failure. Every
// method here is synchronous by design: the gate's check-ceiling-then-
// reserve sequence must complete within a single JS turn with no `await`
// in between, so two "concurrent" (interleaved via the event loop) calls
// can never both observe the same not-yet-reserved budget and both
// proceed — the classic TOCTOU race. Synchronous, single-threaded
// run-to-completion is what makes reserve() atomic here without a mutex.
export interface Reservation {
  id: string;
  roleId: string;
  taskType: string;
  amountUsd: number;
  createdAt: string;
  status: "reserved" | "settled" | "released";
}

export class UnknownReservationError extends Error {}
export class ReservationAlreadyResolvedError extends Error {}

export class ReservationLedger {
  private readonly reservations = new Map<string, Reservation>();
  private settledCompanyUsd = 0;
  private readonly settledByRole = new Map<string, number>();
  private readonly settledByTaskType = new Map<string, number>();

  reserve(roleId: string, taskType: string, amountUsd: number): Reservation {
    const reservation: Reservation = {
      id: randomUUID(),
      roleId,
      taskType,
      amountUsd,
      createdAt: new Date().toISOString(),
      status: "reserved",
    };
    this.reservations.set(reservation.id, reservation);
    return reservation;
  }

  settle(reservationId: string, actualAmountUsd: number): void {
    const reservation = this.getReserved(reservationId);
    reservation.status = "settled";
    this.settledCompanyUsd += actualAmountUsd;
    this.settledByRole.set(reservation.roleId, (this.settledByRole.get(reservation.roleId) ?? 0) + actualAmountUsd);
    this.settledByTaskType.set(
      reservation.taskType,
      (this.settledByTaskType.get(reservation.taskType) ?? 0) + actualAmountUsd,
    );
  }

  release(reservationId: string): void {
    const reservation = this.getReserved(reservationId);
    reservation.status = "released";
  }

  private getReserved(reservationId: string): Reservation {
    const reservation = this.reservations.get(reservationId);
    if (!reservation) throw new UnknownReservationError(`No reservation "${reservationId}".`);
    if (reservation.status !== "reserved") {
      throw new ReservationAlreadyResolvedError(`Reservation "${reservationId}" is already ${reservation.status}.`);
    }
    return reservation;
  }

  // ---- reads used by ceiling checks: actuals (settled) + in-flight (reserved) ----

  reservedCompanyUsd(): number {
    return this.sumReserved(() => true);
  }

  reservedRoleUsd(roleId: string): number {
    return this.sumReserved((r) => r.roleId === roleId);
  }

  reservedTaskTypeUsd(taskType: string): number {
    return this.sumReserved((r) => r.taskType === taskType);
  }

  settledCompanyTotal(): number {
    return this.settledCompanyUsd;
  }

  settledRoleTotal(roleId: string): number {
    return this.settledByRole.get(roleId) ?? 0;
  }

  settledTaskTypeTotal(taskType: string): number {
    return this.settledByTaskType.get(taskType) ?? 0;
  }

  private sumReserved(predicate: (r: Reservation) => boolean): number {
    let total = 0;
    for (const r of this.reservations.values()) {
      if (r.status === "reserved" && predicate(r)) total += r.amountUsd;
    }
    return total;
  }
}
