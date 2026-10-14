import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { zRole } from '@nexo/contracts';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../../common/prisma.module';

export interface ListUsersQuery {
  page: number;
  pageSize: number;
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListUsersQuery) {
    const where = {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        select: { id: true, email: true, fullName: true, role: true, isActive: true, createdAt: true },
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, page: query.page, pageSize: query.pageSize, total };
  }

  async create(data: { email: string; password: string; fullName: string; role: string }) {
    zRole.parse(data.role);
    const email = data.email.toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('Ya existe un usuario con ese correo');
    }
    const rounds = Number(process.env.BCRYPT_ROUNDS ?? 10);
    return this.prisma.user.create({
      data: {
        email,
        passwordHash: await bcrypt.hash(data.password, rounds),
        fullName: data.fullName,
        role: data.role,
      },
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    });
  }

  async update(id: string, data: { fullName?: string; role?: string; isActive?: boolean; password?: string }) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException('Usuario no encontrado');
    }
    if (data.role) {
      zRole.parse(data.role);
    }
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(data.fullName !== undefined ? { fullName: data.fullName } : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
        ...(data.password ? { passwordHash: await bcrypt.hash(data.password, Number(process.env.BCRYPT_ROUNDS ?? 10)) } : {}),
      },
      select: { id: true, email: true, fullName: true, role: true, isActive: true },
    });
  }
}
