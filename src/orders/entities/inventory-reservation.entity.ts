import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Order } from './order.entity';

export enum InventoryReservationStatus {
  RESERVED = 'RESERVED',
  RELEASED = 'RELEASED',
}

@Entity('inventory_reservations')
export class InventoryReservation {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  orderId!: string;

  @OneToOne(() => Order, (order) => order.inventoryReservation, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column({
    type: 'simple-enum',
    enum: InventoryReservationStatus,
    default: InventoryReservationStatus.RESERVED,
  })
  status!: InventoryReservationStatus;

  @Column({ type: 'simple-json' })
  reservations!: Array<{ sku: string; qty: number }>;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
