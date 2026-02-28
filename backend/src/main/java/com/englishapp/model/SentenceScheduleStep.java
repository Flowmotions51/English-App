package com.englishapp.model;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "sentence_schedule_steps")
public class SentenceScheduleStep {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "schedule_template_id", nullable = false)
    private ScheduleTemplate scheduleTemplate;

    @Column(name = "step_order", nullable = false)
    private Integer stepOrder;

    @Column(name = "offset_minutes", nullable = false)
    private Integer offsetMinutes;
}
