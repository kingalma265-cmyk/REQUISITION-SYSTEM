-- MySQL database and tables for Octagon Requisition app
-- Run this in phpMyAdmin or MySQL CLI after starting XAMPP MySQL.

CREATE DATABASE IF NOT EXISTS `octagon_requisition`
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE `octagon_requisition`;

CREATE TABLE IF NOT EXISTS `users` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(100) NOT NULL,
  `email` VARCHAR(255) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `role` ENUM('staff','hod','finance','director') NOT NULL DEFAULT 'staff',
  `department` VARCHAR(100) DEFAULT NULL,
  `must_reset_password` TINYINT(1) NOT NULL DEFAULT 0,
  `reset_password_token` VARCHAR(255) DEFAULT NULL,
  `reset_password_expires` DATETIME DEFAULT NULL,
  `otp_code` VARCHAR(6) DEFAULT NULL,
  `otp_expires` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `ux_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `requisitions` (
  `id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `staffName` VARCHAR(100) NOT NULL,
  `requestDate` DATETIME NOT NULL,
  `department` VARCHAR(100) DEFAULT NULL,
  `items` LONGTEXT,
  `grandTotal` DECIMAL(15,2) DEFAULT 0,
  `status` VARCHAR(50) DEFAULT 'PENDING_HOD',
  `history` LONGTEXT,
  `hodSignature` VARCHAR(255) DEFAULT NULL,
  `financeSignature` VARCHAR(255) DEFAULT NULL,
  `directorSignature` VARCHAR(255) DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
