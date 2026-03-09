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

export enum ShipmentStatus {
  REQUESTED = 'REQUESTED',
  SHIPPED = 'SHIPPED',
}

@Entity('shipments')
export class Shipment {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ unique: true })
  orderId!: string;

  @OneToOne(() => Order, (order) => order.shipment, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'orderId' })
  order!: Order;

  @Column({
    type: 'simple-enum',
    enum: ShipmentStatus,
    default: ShipmentStatus.REQUESTED,
  })
  status!: ShipmentStatus;

  @Column({ type: 'varchar', nullable: true })
  carrier?: string | null;

  @Column({ type: 'varchar', nullable: true })
  trackingNumber?: string | null;

  @Column({ type: 'datetime', nullable: true })
  shippedAt?: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
